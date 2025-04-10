const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Apply stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

// Initialize express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Constants and configurations
const CONFIG = {
  timing: {
    delayBetweenRequests: {
      min: 5000,    // Minimum delay between requests (5 seconds)
      max: 15000    // Maximum delay between requests (15 seconds)
    },
    retryDelay: {
      min: 30000,   // Minimum retry delay after error (30 seconds)
      max: 60000    // Maximum retry delay after error (60 seconds)
    },
    sessionTimeout: 3600000,  // Create a new session after this time (1 hour)
    browserLaunchTimeout: 60000, // Browser launch timeout (60 seconds)
    pageTimeout: 30000, // Page navigation timeout (30 seconds)
  },
  
  // Request limits
  limits: {
    maxRequestsPerUID: 50,      // Maximum requests per UID
    maxConsecutiveErrors: 5,    // Stop after this many consecutive errors
    maxTotalRequests: 800,      // Maximum total requests before stopping
    maxConcurrentRequests: 2    // How many requests to run at once
  },
  
  // Endpoint information
  endpoints: {
    formPage: 'https://freefireinfo.in/claim-100-free-fire-likes-via-uid-for-free/',
    apiEndpoint: 'https://freefireinfo.in/claim-process.php'
  },
  
  // Browser settings
  browser: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1280,720'
    ]
  }
};

// User agent list for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Edge/112.0.1722.48',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Edge/111.0.1661.62',
  'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/112.0 Firefox/112.0',
];

// Logger utility
class Logger {
  static types = {
    INFO: 'INFO',
    SUCCESS: 'SUCCESS',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG'
  };
  
  static log(type, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${type}: ${message}`;
    
    switch (type) {
      case this.types.ERROR:
        console.error(logMessage, data ? data : '');
        break;
      case this.types.WARNING:
        console.warn(logMessage, data ? data : '');
        break;
      case this.types.SUCCESS:
        console.log(`${logMessage}`, data ? data : '');
        break;
      default:
        console.log(logMessage, data ? data : '');
    }
    
    // Write to log file
    const logFileName = `${new Date().toISOString().split('T')[0]}.log`;
    const logFilePath = path.join(logsDir, logFileName);
    
    const logEntry = `${logMessage}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    fs.appendFileSync(logFilePath, logEntry);
    
    return logMessage;
  }
  
  static info(message, data = null) {
    return this.log(this.types.INFO, message, data);
  }
  
  static success(message, data = null) {
    return this.log(this.types.SUCCESS, message, data);
  }
  
  static warn(message, data = null) {
    return this.log(this.types.WARNING, message, data);
  }
  
  static error(message, data = null) {
    return this.log(this.types.ERROR, message, data);
  }
  
  static debug(message, data = null) {
    return this.log(this.types.DEBUG, message, data);
  }
}

// Storage utility for persistent data across restarts
class Storage {
  static getFilePath(key) {
    return path.join(dataDir, `${key}.json`);
  }
  
  static save(key, data) {
    try {
      fs.writeFileSync(this.getFilePath(key), JSON.stringify(data, null, 2));
      Logger.debug(`Saved data for key: ${key}`);
      return true;
    } catch (error) {
      Logger.error(`Failed to save data for key: ${key}`, error);
      return false;
    }
  }
  
  static load(key, defaultValue = null) {
    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      }
      return defaultValue;
    } catch (error) {
      Logger.error(`Failed to load data for key: ${key}`, error);
      return defaultValue;
    }
  }
  
  static remove(key) {
    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        Logger.debug(`Removed data for key: ${key}`);
      }
      return true;
    } catch (error) {
      Logger.error(`Failed to remove data for key: ${key}`, error);
      return false;
    }
  }
}

// Random utility functions
class RandomUtils {
  static getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  static getRandomUserAgent() {
    const randomIndex = Math.floor(Math.random() * USER_AGENTS.length);
    return USER_AGENTS[randomIndex];
  }
  
  static generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }
}

// Browser Pool Manager
class BrowserManager {
  constructor() {
    this.browsers = new Map();
    this.activeSessions = new Map();
  }
  
  async getBrowser(sessionId) {
    // Check if there's already a browser for this session
    if (this.browsers.has(sessionId)) {
      return this.browsers.get(sessionId);
    }
    
    try {
      Logger.info(`Launching new browser for session ${sessionId}...`);
      const browser = await puppeteer.launch({
        headless: CONFIG.browser.headless,
        args: CONFIG.browser.args,
        timeout: CONFIG.timing.browserLaunchTimeout
      });
      
      // Set up browser close handler
      browser.on('disconnected', () => {
        Logger.info(`Browser for session ${sessionId} disconnected`);
        this.browsers.delete(sessionId);
        this.activeSessions.delete(sessionId);
      });
      
      this.browsers.set(sessionId, browser);
      return browser;
    } catch (error) {
      Logger.error(`Failed to launch browser for session ${sessionId}`, error);
      throw error;
    }
  }
  
  async createSession(uid) {
    const sessionId = RandomUtils.generateSessionId();
    const browser = await this.getBrowser(sessionId);
    
    try {
      // Create and set up a new page
      const page = await browser.newPage();
      
      // Set random user agent
      const userAgent = RandomUtils.getRandomUserAgent();
      await page.setUserAgent(userAgent);
      
      // Set default navigation timeout
      page.setDefaultNavigationTimeout(CONFIG.timing.pageTimeout);
      
      // Enable request interception
      await page.setRequestInterception(true);
      
      // Handle request interception - block unnecessary resources
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      // Create session data
      const session = {
        id: sessionId,
        uid: uid,
        browser: browser,
        page: page,
        userAgent: userAgent,
        startTime: Date.now(),
        requests: 0,
        success: 0,
        errors: 0,
        consecutiveErrors: 0,
        lastRequest: null
      };
      
      this.activeSessions.set(sessionId, session);
      Logger.info(`Created new session ${sessionId} for UID ${uid}`);
      
      return session;
    } catch (error) {
      Logger.error(`Failed to create session for UID ${uid}`, error);
      throw error;
    }
  }
  
  async closeSession(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return false;
      }
      
      // Close the page
      if (session.page && !session.page.isClosed()) {
        await session.page.close();
      }
      
      // Check if this is the last page for this browser
      const pages = await session.browser.pages();
      if (pages.length <= 1) { // Only [about:blank] remains
        await session.browser.close();
        this.browsers.delete(sessionId);
      }
      
      this.activeSessions.delete(sessionId);
      Logger.info(`Closed session ${sessionId}`);
      return true;
    } catch (error) {
      Logger.error(`Error closing session ${sessionId}`, error);
      // Force remove from maps even if there was an error
      this.activeSessions.delete(sessionId);
      this.browsers.delete(sessionId);
      return false;
    }
  }
  
  async closeAllSessions() {
    const sessionIds = [...this.activeSessions.keys()];
    const results = [];
    
    for (const sessionId of sessionIds) {
      try {
        const result = await this.closeSession(sessionId);
        results.push({ sessionId, success: result });
      } catch (error) {
        results.push({ sessionId, success: false, error: error.message });
      }
    }
    
    return results;
  }
  
  getActiveSessions() {
    const sessions = [];
    this.activeSessions.forEach((session, sessionId) => {
      sessions.push({
        id: sessionId,
        uid: session.uid,
        startTime: session.startTime,
        requests: session.requests,
        success: session.success,
        errors: session.errors,
        lastRequest: session.lastRequest
      });
    });
    return sessions;
  }
  
  getSessionCount() {
    return this.activeSessions.size;
  }
  
  getBrowserCount() {
    return this.browsers.size;
  }
}

// API Handler for Free Fire Like System
class ApiHandler {
  constructor() {
    this.browserManager = new BrowserManager();
    
    // Global statistics
    this.stats = Storage.load('ff_liker_stats', {
      totalRequests: 0,
      totalSuccess: 0,
      totalErrors: 0,
      requestsByUID: {},
      startTime: Date.now(),
      lastUpdateTime: null
    });
    
    // Active tasks
    this.activeTasks = new Map();
    
    // Queue for pending UIDs
    this.queue = [];
    
    // Running state
    this.isRunning = false;
  }
  
  // Initialize API handler
  init() {
    Logger.info('Initializing API Handler');
    
    // Schedule stats saving
    setInterval(() => {
      Storage.save('ff_liker_stats', this.stats);
    }, 60000); // Save stats every minute
    
    return this;
  }
  
  // Update statistics
  updateStats(uid, success) {
    // Update global stats
    this.stats.totalRequests++;
    if (success) {
      this.stats.totalSuccess++;
    } else {
      this.stats.totalErrors++;
    }
    
    // Update UID-specific stats
    if (!this.stats.requestsByUID[uid]) {
      this.stats.requestsByUID[uid] = {
        success: 0,
        errors: 0,
        total: 0
      };
    }
    
    this.stats.requestsByUID[uid].total++;
    if (success) {
      this.stats.requestsByUID[uid].success++;
    } else {
      this.stats.requestsByUID[uid].errors++;
    }
    
    this.stats.lastUpdateTime = Date.now();
  }
  
  // Reset statistics
  resetStats() {
    this.stats = {
      totalRequests: 0,
      totalSuccess: 0,
      totalErrors: 0,
      requestsByUID: {},
      startTime: Date.now(),
      lastUpdateTime: Date.now()
    };
    
    Storage.save('ff_liker_stats', this.stats);
    Logger.info('Statistics reset');
  }
  
  // Check if we should continue for a specific UID
  shouldContinueForUID(uid) {
    if (!this.stats.requestsByUID[uid]) return true;
    
    if (this.stats.requestsByUID[uid].total >= CONFIG.limits.maxRequestsPerUID) {
      Logger.warn(`Reached maximum requests limit for UID ${uid} (${CONFIG.limits.maxRequestsPerUID})`);
      return false;
    }
    
    return true;
  }
  
  // Add a UID to the processing queue
  addToQueue(uid) {
    // Check if the UID is valid
    if (!uid || !uid.match(/^\d+$/)) {
      throw new Error('Invalid UID format. UID must be numeric');
    }
    
    // Check if we should continue for this UID
    if (!this.shouldContinueForUID(uid)) {
      throw new Error(`UID ${uid} has reached the maximum request limit`);
    }
    
    // Check if the UID is already in queue
    if (this.queue.includes(uid)) {
      throw new Error(`UID ${uid} is already in queue`);
    }
    
    // Add to queue
    this.queue.push(uid);
    Logger.info(`Added UID ${uid} to queue. Queue length: ${this.queue.length}`);
    
    // Start processing if not already running
    if (!this.isRunning) {
      this.startProcessing();
    }
    
    return {
      uid: uid,
      position: this.queue.length
    };
  }
  
  // Start processing the queue
  startProcessing() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    Logger.info('Started queue processing');
    
    // Start the queue processor
    this.processQueue();
  }
  
  // Stop processing
  stopProcessing() {
    this.isRunning = false;
    Logger.info('Stopped queue processing');
    
    // Close all active browser sessions
    return this.browserManager.closeAllSessions();
  }
  
  // Process the queue
  async processQueue() {
    // Check if we should stop
    if (!this.isRunning) return;
    
    // Check if we can start more tasks
    const activeTaskCount = this.activeTasks.size;
    if (activeTaskCount < CONFIG.limits.maxConcurrentRequests && this.queue.length > 0) {
      const uid = this.queue.shift();
      this.processUID(uid);
    }
    
    // Schedule next check
    setTimeout(() => this.processQueue(), 1000);
  }
  
  // Process a single UID
  async processUID(uid) {
    if (this.activeTasks.has(uid)) {
      Logger.warn(`UID ${uid} is already being processed`);
      return;
    }
    
    if (!this.shouldContinueForUID(uid)) {
      Logger.warn(`Skipping UID ${uid} due to request limit`);
      return;
    }
    
    // Mark UID as being processed
    this.activeTasks.set(uid, {
      uid: uid,
      startTime: Date.now(),
      session: null
    });
    
    try {
      // Create a new session for this UID
      const session = await this.browserManager.createSession(uid);
      this.activeTasks.get(uid).session = session.id;
      
      // Send the like request
      Logger.info(`Starting like request for UID: ${uid}`);
      const result = await this.submitLikeRequest(session);
      
      // Update statistics
      this.updateStats(uid, result.success);
      
      // Update session statistics
      session.requests++;
      if (result.success) {
        session.success++;
        session.consecutiveErrors = 0;
      } else {
        session.errors++;
        session.consecutiveErrors++;
      }
      session.lastRequest = Date.now();
      
      // Check if we should stop due to too many errors
      if (session.consecutiveErrors >= CONFIG.limits.maxConsecutiveErrors) {
        Logger.error(`Too many consecutive errors for UID ${uid}, closing session`);
        await this.browserManager.closeSession(session.id);
      } else if (this.shouldContinueForUID(uid)) {
        // Calculate next delay
        const nextDelay = result.success 
          ? RandomUtils.getRandomDelay(CONFIG.timing.delayBetweenRequests.min, CONFIG.timing.delayBetweenRequests.max)
          : RandomUtils.getRandomDelay(CONFIG.timing.retryDelay.min, CONFIG.timing.retryDelay.max);
        
        Logger.info(`UID ${uid}: Scheduling next request in ${nextDelay/1000} seconds`);
        
        // Add UID back to queue after delay
        setTimeout(() => {
          if (this.isRunning) {
            this.queue.push(uid);
          }
        }, nextDelay);
      }
    } catch (error) {
      Logger.error(`Error processing UID ${uid}:`, error);
      
      // Update error statistics
      this.updateStats(uid, false);
    } finally {
      // Remove from active tasks
      this.activeTasks.delete(uid);
    }
  }
  
  // Submit a like request to Free Fire
  async submitLikeRequest(session) {
    const { page, uid } = session;
    let result = {
      success: false,
      message: '',
      timestamp: Date.now()
    };
    
    try {
      // Navigate to the form page
      Logger.info(`Navigating to ${CONFIG.endpoints.formPage}`);
      await page.goto(CONFIG.endpoints.formPage, { waitUntil: 'networkidle2' });
      
      // Wait for the form to be available
      await page.waitForSelector('#uid', { timeout: 10000 });
      
      // Fill in the UID field
      Logger.info(`Filling in UID: ${uid}`);
      await page.type('#uid', uid);
      
      // Check if Turnstile is present
      const hasTurnstile = await page.evaluate(() => {
        return !!document.querySelector('.cf-turnstile') || 
               !!document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      });
      
      if (hasTurnstile) {
        Logger.info('Cloudflare Turnstile detected, waiting for verification');
        
        // Wait for turnstile iframe to be ready
        await page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', { timeout: 10000 });
        
        // Handle turnstile in a more robust way
        try {
          // Wait for turnstile to be solved automatically
          // Some turnstiles solve automatically with proper browser fingerprinting
          await page.waitForFunction(() => {
            // Check for turnstile token
            const tokenElement = document.querySelector('[name="cf-turnstile-response"]');
            return tokenElement && tokenElement.value && tokenElement.value.length > 0;
          }, { timeout: 15000 });
          
          Logger.success('Turnstile appears to be solved automatically');
        } catch (turnstileError) {
          Logger.warn('Automatic turnstile solving timed out, may require manual intervention');
          // Continue anyway - the form submission will likely fail if turnstile wasn't solved
        }
      }
      
      // Submit the form
      Logger.info('Submitting the form');
      
      // Use Promise.all to wait for both the click and the navigation/network events
      const responsePromise = Promise.race([
        page.waitForResponse(response => {
          return response.url().includes('claim-process.php') && response.request().method() === 'POST';
        }),
        page.waitForSelector('.success-message, .error-message', { timeout: 10000 }),
        new Promise(resolve => setTimeout(resolve, 10000)) // Fallback timeout
      ]);
      
      // Click the submit button
      await page.click('#submit-button');
      
      // Wait for response
      const response = await responsePromise;
      
      // Check for success or error messages
      const status = await page.evaluate(() => {
        const successMsg = document.querySelector('.success-message');
        const errorMsg = document.querySelector('.error-message');
        
        if (successMsg) {
          return { success: true, message: successMsg.textContent.trim() };
        } else if (errorMsg) {
          return { success: false, message: errorMsg.textContent.trim() };
        } else {
          return { success: false, message: 'No status message found' };
        }
      });
      
      result.success = status.success;
      result.message = status.message;
      
      if (result.success) {
        Logger.success(`Successfully sent like for UID ${uid}: ${result.message}`);
      } else {
        Logger.warn(`Like request failed for UID ${uid}: ${result.message}`);
      }
    } catch (error) {
      Logger.error(`Error sending like for UID ${uid}:`, error);
      result.message = `Request error: ${error.message}`;
    }
    
    return result;
  }
  
  // Get the current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeTasks: Array.from(this.activeTasks.keys()),
      activeTaskCount: this.activeTasks.size,
      queueLength: this.queue.length,
      queuedUIDs: [...this.queue],
      stats: this.stats,
      sessions: this.browserManager.getActiveSessions(),
      browserCount: this.browserManager.getBrowserCount(),
      sessionCount: this.browserManager.getSessionCount()
    };
  }
}

// Initialize API Handler
const apiHandler = new ApiHandler().init();

// HTML for the homepage
const homepageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Free Fire Auto Liker</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
            color: #333;
        }
        h1, h2, h3 {
            color: #2c3e50;
        }
        .container {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input[type="text"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
        }
        button {
            background-color: #3498db;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
        }
        button:hover {
            background-color: #2980b9;
        }
        button.danger {
            background-color: #e74c3c;
        }
        button.danger:hover {
            background-color: #c0392b;
        }
        button.success {
            background-color: #2ecc71;
        }
        button.success:hover {
            background-color: #27ae60;
        }
        .status {
            padding: 15px;
            border-left: 5px solid #3498db;
            background-color: #f8f9fa;
            margin-bottom: 15px;
        }
        .status.running {
            border-left-color: #2ecc71;
        }
        .status.stopped {
            border-left-color: #e74c3c;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 15px;
        }
        th, td {
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f2f2f2;
        }
        tr:hover {
            background-color: #f5f5f5;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 15px;
        }
        .stats-card {
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .stats-card h3 {
            margin-top: 0;
            color: #7f8c8d;
            font-size: 14px;
            text-transform: uppercase;
        }
        .stats-card p {
            margin: 0;
            font-size: 24px;
            font-weight: bold;
            color: #2c3e50;
        }
    </style>
</head>
<body>
    <h1>Free Fire Auto Liker</h1>
    
    <div class="container">
        <h2>Add UID</h2>
        <div class="form-group">
            <label for="uid">Free Fire UID:</label>
            <input type="text" id="uid" placeholder="Enter UID (e.g., 123456789)">
        </div>
        <button id="add-uid" class="success">Add UID to Queue</button>
    </div>
    
    <div class="container">
        <h2>Controls</h2>
        <button id="start-btn" class="success">Start Processing</button>
        <button id="stop-btn" class="danger">Stop Processing</button>
        <button id="reset-stats-btn">Reset Statistics</button>
    </div>
    
    <div class="container">
        <h2>Status</h2>
        <div id="status" class="status">Loading status...</div>
        
        <h3>Statistics</h3>
        <div class="grid">
            <div class="stats-card">
                <h3>Total Requests</h3>
                <p id="total-requests">0</p>
            </div>
            <div class="stats-card">
                <h3>Successful</h3>
                <p id="total-success">0</p>
            </div>
            <div class="stats-card">
                <h3>Failed</h3>
                <p id="total-errors">0</p>
            </div>
            <div class="stats-card">
                <h3>Active Tasks</h3>
                <p id="active-tasks">0</p>
            </div>
        </div>
        
        <h3>Queue</h3>
        <div id="queue-info">Loading queue...</div>
        
        <h3>Active Tasks</h3>
        <div id="tasks-info">Loading tasks...</div>
        
        <h3>UID Statistics</h3>
<div id="uid-stats">Loading stats...</div>
</div>

<script>
  async function refreshStatus() {
    const res = await fetch('/api/status');
    const data = await res.json();

    document.getElementById('total-requests').textContent = data.stats.totalRequests;
    document.getElementById('total-success').textContent = data.stats.totalSuccess;
    document.getElementById('total-errors').textContent = data.stats.totalErrors;
    document.getElementById('active-tasks').textContent = data.activeTaskCount;

    document.getElementById('status').textContent = data.isRunning ? "Running" : "Stopped";
    document.getElementById('status').className = 'status ' + (data.isRunning ? 'running' : 'stopped');

    document.getElementById('queue-info').innerHTML = data.queuedUIDs.join('<br>') || 'No UIDs in queue';
    document.getElementById('tasks-info').innerHTML = data.activeTasks.join('<br>') || 'No active tasks';

    const uidStats = Object.entries(data.stats.requestsByUID)
      .map(([uid, s]) => `<b>${uid}</b>: ${s.success} success / ${s.errors} errors (${s.total} total)`)
      .join('<br>');
    document.getElementById('uid-stats').innerHTML = uidStats || 'No UID stats yet';
  }

  document.getElementById('add-uid').onclick = async () => {
    const uid = document.getElementById('uid').value.trim();
    if (!uid) return alert('Please enter a UID');
    const res = await fetch('/api/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid })
    });
    const data = await res.json();
    if (data.success) {
      alert(`UID ${data.uid} added at position ${data.position}`);
      document.getElementById('uid').value = '';
    } else {
      alert(data.error || 'Failed to add UID');
    }
    refreshStatus();
  };

  document.getElementById('start-btn').onclick = async () => {
    await fetch('/api/start', { method: 'POST' });
    refreshStatus();
  };

  document.getElementById('stop-btn').onclick = async () => {
    await fetch('/api/stop', { method: 'POST' });
    refreshStatus();
  };

  document.getElementById('reset-stats-btn').onclick = async () => {
    if (confirm('Are you sure you want to reset all statistics?')) {
      await fetch('/api/reset', { method: 'POST' });
      refreshStatus();
    }
  };

  refreshStatus();
  setInterval(refreshStatus, 5000); // Auto-refresh every 5s
</script>
</body>
</html>
// API Routes
app.post('/api/add', (req, res) => {
  try {
    const { uid } = req.body;
    const result = apiHandler.addToQueue(uid);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/start', (req, res) => {
  apiHandler.startProcessing();
  res.json({ success: true, message: 'Processing started' });
});

app.post('/api/stop', async (req, res) => {
  const result = await apiHandler.stopProcessing();
  res.json({ success: true, message: 'Processing stopped', result });
});

app.post('/api/reset', (req, res) => {
  apiHandler.resetStats();
  res.json({ success: true, message: 'Statistics reset' });
});

app.get('/api/status', (req, res) => {
  const status = apiHandler.getStatus();
  res.json(status);
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  Logger.success(`Server is running on port ${PORT}`);
});