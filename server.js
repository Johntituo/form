require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 8765);
const IS_PROD = process.env.NODE_ENV === "production";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "site.json");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.warn("⚠️ ADMIN_PASSWORD 尚未设置，或长度少于 12 位。开发者登录将被禁用，部署前请配置强密码。");
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.warn("⚠️ SESSION_SECRET 尚未设置或太短。请在环境变量中配置至少 32 个字符的随机密钥。");
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  const bundled = path.join(__dirname, "data", "site.seed.json");
  fs.copyFileSync(bundled, DATA_FILE);
}
app.disable("x-powered-by");
app.set("trust proxy", IS_PROD ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["https://www.youtube-nocookie.com", "https://www.youtube.com"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: IS_PROD ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: IS_PROD ? "1h" : 0 }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "尝试次数过多，请 15 分钟后再试。" }
});

function readSite() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeSite(site) {
  const tmp = DATA_FILE + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(site, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}
function safeString(v, max, field, required = false) {
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) {
    throw new Error(`${field} 格式不正确或长度超限。`);
  }
  return v.trim();
}
function validateSite(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("配置格式无效。");
  const brand = safeString(input.brand, 40, "品牌名", true);
  const tagline = safeString(input.tagline, 120, "副标题");
  const announcement = safeString(input.announcement, 500, "公告");
  if (!Array.isArray(input.workouts) || input.workouts.length < 1 || input.workouts.length > 12) {
    throw new Error("训练模板数量应为 1–12 个。");
  }
  const workouts = input.workouts.map((w, wi) => {
    if (!w || typeof w !== "object") throw new Error(`第 ${wi + 1} 个训练模板无效。`);
    const id = safeString(String(w.id || `workout-${wi + 1}`), 48, "模板 ID", true).replace(/[^a-zA-Z0-9_-]/g, "");
    const title = safeString(w.title, 60, "训练名称", true);
    const focus = safeString(w.focus || "", 80, "训练重点");
    const description = safeString(w.description || "", 400, "训练说明");
    const met = Number(w.met);
    if (!Number.isFinite(met) || met < 1 || met > 15) throw new Error(`${title} 的 MET 值应在 1–15 之间。`);
    if (!Array.isArray(w.exercises) || w.exercises.length < 1 || w.exercises.length > 30) throw new Error(`${title} 的动作数量应为 1–30 个。`);
    const exercises = w.exercises.map((e, ei) => {
      if (!e || typeof e !== "object") throw new Error(`${title} 第 ${ei + 1} 个动作无效。`);
      const exercise = {
        id: safeString(String(e.id || `e-${ei + 1}`), 60, "动作 ID", true).replace(/[^a-zA-Z0-9_-]/g, ""),
        nameGym: safeString(e.nameGym || e.name || "", 100, "健身房动作", true),
        nameHome: safeString(e.nameHome || e.nameGym || e.name || "", 100, "居家动作", true),
        sets: safeString(e.sets || "", 100, "组数次数"),
        minutes: Number(e.minutes),
        met: Number(e.met),
        area: safeString(e.area || "", 50, "训练部位"),
        cues: Array.isArray(e.cues) ? e.cues.slice(0, 8).map(x => safeString(String(x), 220, "动作要点")) : [],
        videoUrl: safeString(e.videoUrl || "", 500, "视频地址")
      };
      if (!Number.isFinite(exercise.minutes) || exercise.minutes < 1 || exercise.minutes > 90) throw new Error(`${exercise.nameGym} 的时长须为 1–90 分钟。`);
      if (!Number.isFinite(exercise.met) || exercise.met < 1 || exercise.met > 15) throw new Error(`${exercise.nameGym} 的 MET 值须为 1–15。`);
      if (exercise.videoUrl) {
        const u = new URL(exercise.videoUrl);
        const allowed = ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"];
        if (u.protocol !== "https:" || !allowed.includes(u.hostname)) throw new Error("教学视频目前仅允许使用 HTTPS YouTube 链接。");
      }
      return exercise;
    });
    return { id, title, focus, description, met, exercises };
  });
  return { brand, tagline, announcement, workouts };
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const p = part.trim();
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return "";
}
function sessionToken(req) {
  const value = getCookie(req, "form_admin");
  const item = sessions.get(value);
  if (!item || item.expires < Date.now()) {
    if (value) sessions.delete(value);
    return null;
  }
  item.expires = Date.now() + SESSION_TTL_MS;
  return value;
}
function requireAdmin(req, res, next) {
  if (!sessionToken(req)) return res.status(401).json({ error: "请先登录开发者模式。" });
  next();
}
function isSameOrigin(req) {
  const origin = req.get("origin");
  if (!origin) return true; // curl/CLI may omit Origin; session cookie is SameSite=Lax.
  try {
    return new URL(origin).host === req.get("host");
  } catch { return false; }
}
function timingSafePassword(a, b) {
  const aa = crypto.createHash("sha256").update(String(a)).digest();
  const bb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(aa, bb);
}
function videoEmbed(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (["youtu.be"].includes(u.hostname)) {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    }
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname)) {
      const id = u.searchParams.get("v");
      return /^[\w-]{11}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    }
  } catch {}
  return "";
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/site", (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(readSite());
  } catch {
    res.status(500).json({ error: "网站配置读取失败。" });
  }
});
app.get("/api/admin/session", (req, res) => res.json({ authenticated: !!sessionToken(req) }));
app.post("/api/admin/login", loginLimiter, (req, res) => {
  if (!isSameOrigin(req)) return res.status(403).json({ error: "请求来源校验失败。" });
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || !SESSION_SECRET || SESSION_SECRET.length < 32) {
    return res.status(503).json({ error: "开发者登录尚未配置。请先在服务器设置 ADMIN_PASSWORD（至少 12 位）与 SESSION_SECRET（至少 32 位）。" });
  }
  const password = req.body && req.body.password;
  if (typeof password !== "string" || !timingSafePassword(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "密码不正确。" });
  }
  const token = crypto.createHmac("sha256", SESSION_SECRET).update(crypto.randomBytes(32)).digest("hex");
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  res.cookie("form_admin", token, {
    httpOnly: true, secure: IS_PROD, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS
  });
  res.json({ ok: true, expiresInHours: 8 });
});
app.post("/api/admin/logout", (req, res) => {
  if (!isSameOrigin(req)) return res.status(403).json({ error: "请求来源校验失败。" });
  const token = getCookie(req, "form_admin");
  sessions.delete(token);
  res.clearCookie("form_admin", { httpOnly: true, secure: IS_PROD, sameSite: "lax", path: "/" });
  res.json({ ok: true });
});
app.put("/api/admin/site", requireAdmin, (req, res) => {
  if (!isSameOrigin(req)) return res.status(403).json({ error: "请求来源校验失败。" });
  try {
    const site = validateSite(req.body);
    writeSite(site);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, site });
  } catch (e) {
    res.status(400).json({ error: e.message || "保存失败。" });
  }
});
app.get("/api/admin/export", requireAdmin, (_req, res) => {
  res.set("Content-Disposition", 'attachment; filename="form-site-config.json"');
  res.json(readSite());
});
app.post("/api/admin/import", requireAdmin, (req, res) => {
  if (!isSameOrigin(req)) return res.status(403).json({ error: "请求来源校验失败。" });
  try {
    const site = validateSite(req.body);
    writeSite(site);
    res.json({ ok: true, site });
  } catch (e) { res.status(400).json({ error: e.message || "导入失败。" }); }
});

// Expire stale in-memory sessions.
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessions) if (val.expires < now) sessions.delete(key);
}, 30 * 60 * 1000).unref();

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "服务器内部错误。" });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`FORM public fitness app listening on 0.0.0.0:${PORT}`);
});
