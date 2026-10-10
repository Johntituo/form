$ErrorActionPreference = "Stop"
Write-Host "FORM Fitness 本地开发环境配置" -ForegroundColor Cyan
$passwordSecure = Read-Host "请设置开发者密码（建议 16 位以上）" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($password.Length -lt 12) { throw "密码至少需要 12 个字符。" }
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
$envText = "ADMIN_PASSWORD=$password`r`nSESSION_SECRET=$secret`r`nNODE_ENV=development`r`nPORT=8765`r`n"
Set-Content -Path ".env" -Value $envText -Encoding ascii
Write-Host ".env 已写入。请勿上传此文件到代码仓库。" -ForegroundColor Green
