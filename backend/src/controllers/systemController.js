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

/**
 * Get all tags (versions) from remote repository
 */
const getTags = async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    // Fetch latest tags from remote
    try {
      execSync('git fetch origin --tags', { cwd: projectRoot });
    } catch (e) {
      // Continue even if fetch fails (offline mode)
    }

    // Get all tags sorted by version (newest first)
    const tagsOutput = execSync(
      'git tag --sort=-version:refname',
      { cwd: projectRoot }
    ).toString().trim();

    const tags = tagsOutput
      ? tagsOutput.split('\n').map(tag => {
          let date = '';
          try {
            date = execSync(`git log -1 --format=%cd --date=iso "${tag}"`, { cwd: projectRoot })
              .toString().trim();
          } catch (e) { /* ignore */ }

          let message = '';
          try {
            message = execSync(`git tag -l -n1 "${tag}"`, { cwd: projectRoot })
              .toString().trim().replace(tag, '').trim();
          } catch (e) { /* ignore */ }

          return { name: tag, date, message };
        })
      : [];

    res.json({
      tags,
      currentVersion: getCurrentVersion()
    });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Versionen' });
  }
};

/**
 * Get all remote branches (requires dev password)
 */
const getBranches = async (req, res) => {
  try {
    const { password } = req.query;

    if (!password || password !== 'netrock!') {
      return res.status(403).json({ error: 'Falsches Entwickler-Passwort' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    // Fetch all branches from remote
    try {
      execSync('git fetch origin --prune', { cwd: projectRoot });
    } catch (e) {
      // Continue even if fetch fails
    }

    // Get all remote branches
    const branchesOutput = execSync(
      'git branch -r --format="%(refname:short)"',
      { cwd: projectRoot }
    ).toString().trim();

    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot })
      .toString().trim();

    const branches = branchesOutput
      ? branchesOutput
          .split('\n')
          .map(b => b.trim())
          .filter(b => b && !b.includes('HEAD'))
          .map(b => b.replace('origin/', ''))
      : [];

    res.json({
      branches,
      currentBranch
    });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Branches' });
  }
};

/**
 * Trigger update to a specific version (tag) from main branch
 */
const triggerVersionUpdate = async (req, res) => {
  try {
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'Version ist erforderlich' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    res.json({
      success: true,
      message: `Update auf Version "${tag}" wird durchgeführt. Server startet neu...`
    });

    setTimeout(async () => {
      try {
        console.log(`🔄 Starting version update to "${tag}"...`);

        // 1. Stash any local changes
        try {
          execSync('git stash', { cwd: projectRoot });
        } catch (e) { /* ignore */ }

        // 2. Fetch latest from origin
        execSync('git fetch origin --tags', { cwd: projectRoot });

        // 3. Checkout main and pull
        execSync('git checkout main', { cwd: projectRoot });
        execSync('git pull origin main', { cwd: projectRoot });

        // 4. Checkout the specific tag
        console.log(`🏷️  Checking out tag "${tag}"...`);
        execSync(`git checkout "${tag}"`, { cwd: projectRoot });

        // 5. Install dependencies
        console.log('📦 Updating backend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'backend') });
        console.log('📦 Updating frontend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend') });

        // 6. Build frontend
        console.log('🏗️  Building frontend...');
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend') });

        console.log(`✅ Version update to "${tag}" completed! Restarting server...`);
        process.exit(100);
      } catch (error) {
        console.error('❌ Version update failed:', error.message);
        process.exit(1);
      }
    }, 1000);
  } catch (error) {
    console.error('Error triggering version update:', error);
    res.status(500).json({ error: 'Fehler beim Versions-Update' });
  }
};

module.exports = {
  getLatestVersion,
  triggerUpdate,
  triggerBranchUpdate,
  triggerVersionUpdate,
  getGitInfo,
  getTags,
  getBranches
};
