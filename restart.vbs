' BookWorm — silent restart launcher
' Double-click this file to restart BookWorm.
' Uses pythonw.exe so NO console window ever appears.
' The server runs invisibly in the background.

Dim here, pythonw, script
here    = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
pythonw = here & "\.venv\Scripts\pythonw.exe"
script  = here & "\_start_server.py"

' 0 = hidden window, False = don't wait for it to finish
CreateObject("WScript.Shell").Run """" & pythonw & """ """ & script & """", 0, False
