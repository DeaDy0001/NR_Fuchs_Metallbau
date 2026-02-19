const axios = require('axios');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

// GitHub repository info
const GITHUB_OWNER = 'DeaDy0001';
const GITHUB_REPO = 'NR_Fuchs_Metallbau';

/**
 * Get current version from package.json
 */
const getCurrentVersion = () => {
  const packagePath = path.join(__dirname, '../../package.json');
  const packageJson = require(packagePath);
  return packageJson.version;
};

/**
 * Get latest version from GitHub releases
 */
const getLatestVersion = async (req, res) => {
  try {
    const currentVersion = getCurrentVersion();

    // Fetch latest release from GitHub API
    const response = await axios.get(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Fuchs-Metallbau-App'
        }
      }
    );

    const latestRelease = response.data;
    const latestVersion = latestRelease.tag_name.replace(/^v/, ''); // Remove 'v' prefix if exists

    res.json({
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseNotes: latestRelease.body,
      releaseName: latestRelease.name,
      publishedAt: latestRelease.published_at,
      downloadUrl: latestRelease.html_url
    });
  } catch (error) {
    // If no releases found or other error
    if (error.response && error.response.status === 404) {
      return res.json({
        currentVersion: getCurrentVersion(),
        latestVersion: null,
        updateAvailable: false,
        message: 'Keine Releases verfügbar'
      });
    }

    console.error('Error fetching latest version:', error.message);
    res.status(500).json({
      error: 'Failed to check for updates',
      currentVersion: getCurrentVersion()
    });
  }
};

/**
 * Compare two semantic versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
const compareVersions = (v1, v2) => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
};

/**
 * Trigger update from GitHub
 * Pulls latest changes and restarts server
 */
const triggerUpdate = async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    // Send response immediately before pulling (connection will be lost during restart)
    res.json({
      success: true,
      message: 'Update wird durchgeführt. Server startet neu...'
    });

    // Schedule update after sending response
    setTimeout(async () => {
      try {
        console.log('🔄 Starting update process...');

        // 1. Stash any local changes
        console.log('📦 Stashing local changes...');
        try {
          execSync('git stash', { cwd: projectRoot });
        } catch (e) {
          // Ignore if nothing to stash
        }

        // 2. Fetch latest from origin
        console.log('📥 Fetching latest changes...');
        execSync('git fetch origin main', { cwd: projectRoot });

        // 3. Pull latest changes
        console.log('⬇️  Pulling changes...');
        execSync('git pull origin main', { cwd: projectRoot });

        // 4. Install/update dependencies
        console.log('📦 Updating backend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'backend') });

        console.log('📦 Updating frontend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend') });

        // 5. Build frontend
        console.log('🏗️  Building frontend...');
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend') });

        console.log('✅ Update completed! Restarting server...');

        // 6. Restart server (exit code 100 triggers restart in start.bat)
        process.exit(100);
      } catch (error) {
        console.error('❌ Update failed:', error.message);
        // Exit anyway to trigger restart - user can manually fix issues
        process.exit(1);
      }
    }, 1000);
  } catch (error) {
    console.error('Error triggering update:', error);
    res.status(500).json({
      error: 'Failed to trigger update',
      details: error.message
    });
  }
};

/**
 * Get current Git commit info
 */
const getGitInfo = (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot })
      .toString()
      .trim();

    const commit = execSync('git rev-parse --short HEAD', { cwd: projectRoot })
      .toString()
      .trim();

    const commitMessage = execSync('git log -1 --pretty=%B', { cwd: projectRoot })
      .toString()
      .trim();

    const commitDate = execSync('git log -1 --pretty=%cd --date=iso', { cwd: projectRoot })
      .toString()
      .trim();

    res.json({
      branch,
      commit,
      commitMessage,
      commitDate,
      version: getCurrentVersion()
    });
  } catch (error) {
    console.error('Error getting git info:', error);
    res.status(500).json({
      error: 'Failed to get git info',
      version: getCurrentVersion()
    });
  }
};

/**
 * Trigger update from specific branch (developer only)
 * Requires password authentication
 */
const triggerBranchUpdate = async (req, res) => {
  try {
    const { branch, password } = req.body;

    // Validate inputs
    if (!branch || !password) {
      return res.status(400).json({ error: 'Branch und Passwort erforderlich' });
    }

    // Check developer password
    if (password !== 'netrock!') {
      return res.status(403).json({ error: 'Falsches Entwickler-Passwort' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    // Send response immediately before pulling
    res.json({
      success: true,
      message: `Update von Branch "${branch}" wird durchgeführt. Server startet neu...`
    });

    // Schedule update after sending response
    setTimeout(async () => {
      try {
        console.log(`🔄 Starting branch update from "${branch}"...`);

        // 1. Stash any local changes
        console.log('📦 Stashing local changes...');
        try {
          execSync('git stash', { cwd: projectRoot });
        } catch (e) {
          // Ignore if nothing to stash
        }

        // 2. Fetch all branches from origin
        console.log('📥 Fetching all branches...');
        execSync('git fetch origin', { cwd: projectRoot });

        // 3. Checkout to specified branch
        console.log(`🔀 Switching to branch "${branch}"...`);
        execSync(`git checkout ${branch}`, { cwd: projectRoot });

        // 4. Pull latest changes from the branch
        console.log('⬇️  Pulling changes...');
        execSync(`git pull origin ${branch}`, { cwd: projectRoot });

        // 5. Install/update dependencies
        console.log('📦 Updating backend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'backend') });

        console.log('📦 Updating frontend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend') });

        // 6. Build frontend
        console.log('🏗️  Building frontend...');
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend') });

        console.log(`✅ Branch update from "${branch}" completed! Restarting server...`);

        // 7. Restart server
        process.exit(100);
      } catch (error) {
        console.error('❌ Branch update failed:', error.message);
        // Exit anyway to trigger restart - user can manually fix issues
        process.exit(1);
      }
    }, 1000);
  } catch (error) {
    console.error('Error triggering branch update:', error);
    res.status(500).json({
      error: 'Failed to trigger branch update',
      details: error.message
    });
  }
};

module.exports = {
  getLatestVersion,
  triggerUpdate,
  triggerBranchUpdate,
  getGitInfo
};
