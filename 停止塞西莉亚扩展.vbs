Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.Run """C:\anaconda3\pythonw.exe"" """ & root & "\launch.py"" stop", 0, False
