const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    frame: true, // we can remove the frame for a fully custom UI later
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#020305',
      symbolColor: '#D4AF37',
      height: 40
    },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For quick fetch/CORS bypass
      webSecurity: false       // OVERRIDE CORS FOR BINANCE/CMC API CALLS!
    },
    backgroundColor: '#020305',
    icon: path.join(__dirname, '../public/vite.svg')
  });

  // Check if we are in dev mode
  const devUrl = 'http://localhost:5173';
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl);
    // Open the DevTools automatically in dev mode
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Relax CORS policy purely for the Electron app level
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('disable-site-isolation-trials');
