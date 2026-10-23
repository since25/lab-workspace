@echo off
chcp 65001 >nul
rem 线上位置：C:\lab-workspace\app\labelprint\verify.bat，用安装包自带的 Python
cd /d "%~dp0"
echo 正在自检，请稍候（不会打出实物标签）...
"C:\lab-workspace\python\python.exe" -m labelprint.selfcheck
echo.
pause
