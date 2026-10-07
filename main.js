const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

let controlWindow;
let displayWindow;

function createWindows() {
  // Get all available displays
  const displays = screen.getAllDisplays();
  
  // Find external display if available (usually has x or y !== 0)
  const externalDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  });

  // 1. Create Control Console Window
  controlWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Kumite Desk - Control Console',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  controlWindow.loadFile('control.html');

  // 2. Create Arena Display Window
  let displayBounds = { x: 0, y: 0 };
  if (externalDisplay) {
    displayBounds = externalDisplay.bounds;
  }

  displayWindow = new BrowserWindow({
    x: displayBounds.x,
    y: displayBounds.y,
    width: 1920,
    height: 1080,
    title: 'Kumite Desk - Arena Display',
    fullscreen: !!externalDisplay, // Auto-fullscreen if on secondary monitor
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  displayWindow.loadFile('index.html');

  // Gracefully close everything if the control window is closed
  controlWindow.on('closed', () => {
    controlWindow = null;
    if (displayWindow) {
      displayWindow.close();
    }
  });

  displayWindow.on('closed', () => {
    displayWindow = null;
  });
}

app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
