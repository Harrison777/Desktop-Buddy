/**
 * Create a Windows desktop shortcut for Desktop Wizard.
 * Uses PowerShell COM to create a .lnk pointing to the Electron runner.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve paths
const projectRoot = path.resolve(__dirname, '..');
const electronExe = path.join(projectRoot, 'node_modules', '.bin', 'electron.cmd');
const icoPath = path.join(projectRoot, 'assets', 'wizard_hat_icon.ico');
// Resolve the real Desktop path (handles OneDrive redirection)
const desktopDir = execSync('powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"', { encoding: 'utf-8' }).trim();
const shortcutPath = path.join(desktopDir, 'Desktop Wizard.lnk');

// Verify electron exists
if (!fs.existsSync(electronExe)) {
  console.error('❌ electron.cmd not found. Run `npm install` first.');
  process.exit(1);
}

// Resolve the actual electron.exe from the cmd wrapper
const electronBinDir = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const targetExe = fs.existsSync(electronBinDir) ? electronBinDir : electronExe;

// Icon path (fallback to electron default if .ico not found)
const iconArg = fs.existsSync(icoPath) ? icoPath : '';

// Build the PowerShell command to create a .lnk shortcut
const ps = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$Shortcut.TargetPath = '${targetExe.replace(/'/g, "''")}' 
$Shortcut.Arguments = '"${projectRoot.replace(/'/g, "''")}"'
$Shortcut.WorkingDirectory = '${projectRoot.replace(/'/g, "''")}' 
${iconArg ? `$Shortcut.IconLocation = '${iconArg.replace(/'/g, "''")}'` : ''}
$Shortcut.Description = 'The Desktop Wizard - AI Desktop Buddy'
$Shortcut.Save()
`.trim();

try {
  execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
    stdio: 'inherit'
  });
  console.log('✅ Desktop shortcut created:', shortcutPath);
  console.log('   Target:', targetExe);
  console.log('   Icon:', iconArg || '(default electron icon)');
} catch (err) {
  console.error('❌ Failed to create shortcut:', err.message);
  process.exit(1);
}
