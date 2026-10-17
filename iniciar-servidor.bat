@echo off
title AulaViva
cd /d "%~dp0"

echo ============================================================
echo            AULAVIVA - Iniciando...
echo ============================================================
echo.

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install --no-audit --no-fund
  echo.
)

echo Servidor en: http://localhost:3000
echo.
echo   Admin:  admin@plataforma.com  /  admin123
echo   Alumno: alumno@plataforma.com / alumno123
echo.
echo Para detener: cerra esta ventana o presiona CTRL+C
echo ============================================================
echo.

start "" "http://localhost:3000"
node server.js

pause
