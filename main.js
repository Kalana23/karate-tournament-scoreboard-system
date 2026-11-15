const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let controlWindow = null;
let displayWindow = null;
let latestState = null;

function createWindows() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const externalDisplay = displays.find(d => d.id !== primaryDisplay.id);

  // --- 1. Control Console Window (Primary Display) ---
  controlWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    width: Math.min(1440, primaryDisplay.workArea.width),
    height: Math.min(900, primaryDisplay.workArea.height),
    title: 'KUMITE DESK — Control Console',
    backgroundColor: '#0c0e14',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  controlWindow.maximize();
  controlWindow.loadFile('control.html');

  // --- 2. Arena Display Window (Secondary Display / Projector) ---
  if (externalDisplay) {
    // HDMI / Secondary monitor detected -> auto-fullscreen on external display
    displayWindow = new BrowserWindow({
      x: externalDisplay.bounds.x,
      y: externalDisplay.bounds.y,
      width: externalDisplay.bounds.width,
      height: externalDisplay.bounds.height,
      fullscreen: true,
      frame: false,
      title: 'ARENA DISPLAY — External Screen',
      backgroundColor: '#050507',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false
      }
    });
  } else {
    // Single monitor fallback (laptop testing mode)
    displayWindow = new BrowserWindow({
      x: primaryDisplay.bounds.x + 50,
      y: primaryDisplay.bounds.y + 50,
      width: 1280,
      height: 720,
      title: 'ARENA DISPLAY — Secondary Monitor (Windowed Test Mode)',
      backgroundColor: '#050507',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false
      }
    });
  }

  displayWindow.loadFile('index.html');
  displayWindow.webContents.on('did-finish-load', () => {
    if (latestState) displayWindow.webContents.send('arena-state-update', latestState);
  });

  // Handle window close interlock
  controlWindow.on('closed', () => {
    controlWindow = null;
    if (displayWindow && !displayWindow.isDestroyed()) {
      displayWindow.close();
    }
  });

  displayWindow.on('closed', () => {
    displayWindow = null;
  });
}

// ============================================================
// IPC COMMUNICATION & HARDWARE BRIDGES
// ============================================================

// Zero-lag direct state broadcast between Electron windows
ipcMain.on('broadcast-state-instant', (event, state) => {
  if (event.sender !== controlWindow?.webContents) return;
  latestState = state;
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.webContents.send('arena-state-update', state);
  }
});

// Arena timer buttons request an action; the control console owns the clock.
ipcMain.on('bunkai-action', (event, action) => {
  if (event.sender !== displayWindow?.webContents || !['start', 'stop', 'reset'].includes(action)) return;
  if (controlWindow && !controlWindow.isDestroyed()) controlWindow.webContents.send('bunkai-action', action);
});

// Direct buzzer audio event forwarding
ipcMain.on('broadcast-buzzer-instant', (event, buzzerData) => {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.webContents.send('arena-buzzer-trigger', buzzerData);
  }
});

// CSV match result exporter
ipcMain.handle('export-result', async (event, rowData) => {
  try {
    // Attempt to write in current workspace directory, fallback to userData
    const localDir = process.cwd();
    let targetPath = path.join(localDir, 'results.csv');

    const header = 'Bout,AKA Name,AKA Country,AO Name,AO Country,AKA Score,AO Score,Winner,Win Reason,Timestamp\n';

    if (!fs.existsSync(targetPath)) {
      try {
        fs.writeFileSync(targetPath, header, 'utf8');
      } catch (err) {
        // Fallback to app data dir if cwd is not writable
        targetPath = path.join(app.getPath('userData'), 'results.csv');
        if (!fs.existsSync(targetPath)) {
          fs.writeFileSync(targetPath, header, 'utf8');
        }
      }
    }

    fs.appendFileSync(targetPath, rowData + '\n', 'utf8');
    return { success: true, path: targetPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Custom Buzzer Audio storage
ipcMain.handle('save-buzzer', async (event, { name, buffer }) => {
  try {
    const saveDir = app.getPath('userData');
    const filePath = path.join(saveDir, `custom_horn_${name || 'default.mp3'}`);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('load-buzzer', async () => {
  try {
    const saveDir = app.getPath('userData');
    const files = fs.readdirSync(saveDir);
    const hornFile = files.find(f => f.startsWith('custom_horn_'));
    if (!hornFile) return null;
    const filePath = path.join(saveDir, hornFile);
    const data = fs.readFileSync(filePath);
    return data.toString('base64');
  } catch (e) {
    return null;
  }
});

// Native CSV File Selection Dialog
ipcMain.handle('open-csv-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog(controlWindow || undefined, {
      title: 'Select Tournament Bouts CSV',
      filters: [{ name: 'CSV Files', extensions: ['csv', 'txt'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return { canceled: false, path: filePath, content };
  } catch (e) {
    return { canceled: true, error: e.message };
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
