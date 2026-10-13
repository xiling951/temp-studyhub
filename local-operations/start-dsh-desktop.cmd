@echo off
rem Launch DSH Desktop with a TEMP directory it is allowed to write.
rem Reason: StudyHub plugin-spawned child processes are denied the system temp
rem directories (pip died with "No usable temporary directory"), while the
rem harness home is writable. Delete this launcher and point the shortcuts back
rem at DSH Desktop.exe to restore the stock behaviour.
set "TEMP=%APPDATA%\dsh-desktop\harness\study\tmp"
set "TMP=%TEMP%"
start "" "C:\Users\Lenovo\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe"