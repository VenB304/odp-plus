@echo off
@REM Clean and build before testing
call npm run clean
call npm run build

@REM start "npm-startC" cmd /k npm run startC
@REM start "npm-start" cmd /k npm start


@REM Start two browser instances for testing
start "npm-startC" cmd /k npm run startC
