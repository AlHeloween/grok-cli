#!/usr/bin/env bun
import { getSettingsManager } from '../src/utils/settings-manager.js';

const manager = getSettingsManager();
console.log('Manager:', manager);
console.log('getRagDbPath:', typeof manager.getRagDbPath);
console.log('getRagQuantize:', typeof manager.getRagQuantize);
console.log('getRagQuantizePreload:', typeof manager.getRagQuantizePreload);

const dbPath = manager.getRagDbPath();
console.log('dbPath:', dbPath);