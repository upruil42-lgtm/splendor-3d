@echo off
title Splendor 3D - Push to GitHub
cd /d "%~dp0"
echo ============================================
echo  Splendor 3D - pushing to GitHub...
echo ============================================
echo.
echo If a login window opens, sign in with GitHub
echo account: upruil42-lgtm and click Authorize.
echo.
echo If it asks "Username" instead:
echo   Username: upruil42-lgtm
echo   Password: paste a Personal Access Token
echo   (get one at github.com/settings/tokens, check "repo")
echo.
echo (characters will be invisible while typing password - that is normal)
echo.
git push -u origin main
echo.
echo ============================================
echo  If you see "branch 'main' set up to track"
echo  above, SUCCESS! Close this window and
echo  tell the AI assistant.
echo ============================================
pause
