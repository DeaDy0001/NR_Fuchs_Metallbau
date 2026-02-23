#!/usr/bin/env node

/**
 * Build Info Generator
 *
 * Erstellt eine build-info.json Datei mit Versions- und Build-Informationen.
 * Funktioniert sowohl mit Git (für Entwicklung) als auch ohne Git (für Releases).
 *
 * Usage: node scripts/generate-build-info.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Lese package.json für Version
const packageJsonPath = path.join(__dirname, '../backend/package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

/**
 * Führt einen Git-Befehl aus und gibt das Ergebnis zurück
 * Gibt null zurück wenn Git nicht verfügbar ist
 */
function gitCommand(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'ignore'] // Ignore stderr
    }).trim();
  } catch (error) {
    return null;
  }
}

// Sammle Build-Informationen
const buildInfo = {
  version: version,
  buildDate: new Date().toISOString(),
  buildTimestamp: Date.now(),
  git: null
};

// Versuche Git-Informationen zu sammeln (wenn Git verfügbar)
const branch = gitCommand('git rev-parse --abbrev-ref HEAD');
const commit = gitCommand('git rev-parse --short HEAD');
const commitLong = gitCommand('git rev-parse HEAD');
const commitMessage = gitCommand('git log -1 --pretty=%B');
const commitDate = gitCommand('git log -1 --pretty=%cd --date=iso');
const commitAuthor = gitCommand('git log -1 --pretty=%an');
const isDirty = gitCommand('git status --porcelain');

if (branch && commit) {
  buildInfo.git = {
    branch: branch,
    commit: commit,
    commitLong: commitLong,
    commitMessage: commitMessage,
    commitDate: commitDate,
    commitAuthor: commitAuthor,
    isDirty: isDirty !== null && isDirty.length > 0
  };
}

// Schreibe build-info.json ins Backend-Verzeichnis
const outputPath = path.join(__dirname, '../backend/build-info.json');
fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2), 'utf8');

console.log('✅ Build-Info erstellt:');
console.log(`   Version:     ${buildInfo.version}`);
console.log(`   Build-Datum: ${new Date(buildInfo.buildDate).toLocaleString('de-DE')}`);

if (buildInfo.git) {
  console.log(`   Git-Branch:  ${buildInfo.git.branch}`);
  console.log(`   Git-Commit:  ${buildInfo.git.commit}`);
  console.log(`   Dirty:       ${buildInfo.git.isDirty ? 'Ja (uncommitted changes)' : 'Nein'}`);
} else {
  console.log('   Git-Info:    Nicht verfügbar (kein Git-Repository)');
}

console.log(`   → ${outputPath}`);
