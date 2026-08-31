@echo off
chcp 65001 >nul
cd /d d:\work\demo-postman
call npm run dev > dev_out.log 2>&1
