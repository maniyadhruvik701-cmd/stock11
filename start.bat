@echo off
TITLE Vastra Startup Script

echo ===================================================
echo VASTRA - Local Server ^& ngrok Startup
echo ===================================================
echo.

echo [1/3] Configuring ngrok authtoken...
call npx ngrok config add-authtoken 3FIaz2H3Rhg6i60YCyTDWjJedMZ_2d2fvAAa44RvTnuGhuivG
echo.

echo [2/3] Starting Node.js Server on Port 3000...
start "Vastra Node Server" cmd /k "node server.js"

echo [3/3] Starting ngrok Tunnel...
start "Vastra ngrok Tunnel" cmd /k "npx ngrok http --domain=flavored-ambiance-grandson.ngrok-free.dev 3000"

echo.
echo ===================================================
echo DONE! 
echo.
echo Your app is now live globally at:
echo https://flavored-ambiance-grandson.ngrok-free.dev
echo.
echo Keep the two new black windows open while using the app.
echo You can close this window now.
echo ===================================================
pause
