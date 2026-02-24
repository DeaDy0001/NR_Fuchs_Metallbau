const axios = require('axios');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// GitHub repository info
const GITHUB_OWNER = 'DeaDy0001';
const GITHUB_REPO = 'NR_Fuchs_Metallbau';

// Check once at startup if git is available
let gitAvailable = false;
try {
  execSync('git --version', { stdio: ['pipe', 'pipe', 'pipe'] });
  gitAvailable = true;
  console.log('✅ Git ist verfügbar');
} catch (e) {
  console.log('⚠️  Git ist nicht installiert. Update-System verwendet GitHub API als Fallback.');
}

// Cache version to avoid repeated console logs
let cachedVersion = null;

/**
 * Get current version
 * Tries to get version from Git tag first (if on a tag)
 * Falls back to package.json if not on a tag or git unavailable
 */
const getCurrentVersion = () => {
  if (cachedVersion) return cachedVersion;

  const projectRoot = path.join(__dirname, '../../..');

  if (gitAvailable) {
    try {
      const currentTag = execSync('git describe --tags --exact-match', {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe']
      }).toString().trim();

      const versionFromTag = currentTag.replace(/^v/, '');
      console.log(`📌 On tag: ${currentTag} → Version: ${versionFromTag}`);
      cachedVersion = versionFromTag;
      return versionFromTag;
    } catch (e) {
      // Not on a tag, fall through to package.json
    }
  }

  // Fall back to package.json
  const packagePath = path.join(__dirname, '../../package.json');
  // Clear require cache so we always read fresh version
  delete require.cache[require.resolve(packagePath)];
  const packageJson = require(packagePath);
  console.log(`📦 Version aus package.json: ${packageJson.version}`);
  cachedVersion = packageJson.version;
  return packageJson.version;
};

/**
 * Reset cached version (call after update)
 */
const resetVersionCache = () => {
  cachedVersion = null;
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
        },
        timeout: 10000
      }
    );

    const latestRelease = response.data;
    const latestVersion = latestRelease.tag_name.replace(/^v/, '');

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
 * Update the version in package.json files after a successful update
 */
const updatePackageJsonVersion = (projectRoot, newVersion) => {
  const version = newVersion.replace(/^v/, '');

  // Update backend/package.json
  const backendPkgPath = path.join(projectRoot, 'backend', 'package.json');
  if (fs.existsSync(backendPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(backendPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`📝 backend/package.json Version aktualisiert: ${version}`);
  }

  // Update frontend/package.json
  const frontendPkgPath = path.join(projectRoot, 'frontend', 'package.json');
  if (fs.existsSync(frontendPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(frontendPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`📝 frontend/package.json Version aktualisiert: ${version}`);
  }

  resetVersionCache();
};

/**
 * Download and extract a GitHub release ZIP (for systems without git)
 * Downloads the source code ZIP, extracts it, and copies files over
 */
const downloadAndApplyUpdate = async (tag, projectRoot) => {
  const tempDir = path.join(os.tmpdir(), `fuchs-update-${Date.now()}`);
  const zipPath = path.join(tempDir, 'release.zip');
  const extractDir = path.join(tempDir, 'extracted');

  try {
    // 1. Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    // 2. Download ZIP from GitHub
    const zipUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/tags/${tag}.zip`;
    console.log(`📥 Lade Release ZIP herunter: ${zipUrl}`);

    const response = await axios.get(zipUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 500 * 1024 * 1024 // 500MB max
    });

    fs.writeFileSync(zipPath, Buffer.from(response.data));
    console.log(`💾 ZIP gespeichert (${Math.round(response.data.byteLength / 1024)} KB)`);

    // 3. Extract ZIP
    console.log('📦 Entpacke ZIP...');
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`,
        { timeout: 120000 }
      );
    } else {
      execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { timeout: 120000 });
    }

    // 4. Find the extracted directory (GitHub adds prefix like "NR_Fuchs_Metallbau-v1.0.5/")
    const extractedDirs = fs.readdirSync(extractDir);
    if (extractedDirs.length === 0) {
      throw new Error('ZIP-Archiv ist leer');
    }
    const sourceDir = path.join(extractDir, extractedDirs[0]);
    console.log(`📂 Quelle: ${sourceDir}`);

    // 5. Copy source files over (preserve node_modules, data, uploads, .env)
    const filesToCopy = [
      { src: 'backend/src', dest: 'backend/src' },
      { src: 'backend/package.json', dest: 'backend/package.json' },
      { src: 'frontend/src', dest: 'frontend/src' },
      { src: 'frontend/public', dest: 'frontend/public' },
      { src: 'frontend/package.json', dest: 'frontend/package.json' },
      { src: 'frontend/vite.config.js', dest: 'frontend/vite.config.js' },
      { src: 'frontend/index.html', dest: 'frontend/index.html' },
    ];

    for (const item of filesToCopy) {
      const srcPath = path.join(sourceDir, item.src);
      const destPath = path.join(projectRoot, item.dest);

      if (fs.existsSync(srcPath)) {
        const stat = fs.statSync(srcPath);
        if (stat.isDirectory()) {
          // Remove old directory and copy new one
          fs.removeSync(destPath);
          fs.copySync(srcPath, destPath);
          console.log(`  ✅ ${item.src}/ kopiert`);
        } else {
          fs.copySync(srcPath, destPath);
          console.log(`  ✅ ${item.src} kopiert`);
        }
      }
    }

    // 6. Also copy any new files in the root (like start.bat, etc.)
    const rootFiles = ['start.bat', 'start.sh', 'README.md', '.gitignore'];
    for (const file of rootFiles) {
      const srcPath = path.join(sourceDir, file);
      if (fs.existsSync(srcPath)) {
        fs.copySync(srcPath, path.join(projectRoot, file));
      }
    }

    // 7. Update version in package.json
    updatePackageJsonVersion(projectRoot, tag);

    console.log('✅ Dateien erfolgreich kopiert');
  } finally {
    // 8. Clean up temp directory
    try {
      fs.removeSync(tempDir);
      console.log('🧹 Temp-Verzeichnis aufgeräumt');
    } catch (e) {
      console.warn('Konnte Temp-Verzeichnis nicht löschen:', tempDir);
    }
  }
};

/**
 * Trigger update from GitHub
 * Uses git pull if available, otherwise downloads ZIP
 */
const triggerUpdate = async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '../../..');

    res.json({
      success: true,
      message: 'Update wird durchgeführt. Server startet neu...'
    });

    setTimeout(async () => {
      try {
        console.log('🔄 Starting update process...');

        if (gitAvailable) {
          // Git-based update
          try { execSync('git stash', { cwd: projectRoot }); } catch (e) { /* ignore */ }
          execSync('git fetch origin main', { cwd: projectRoot });
          execSync('git pull origin main', { cwd: projectRoot });
        } else {
          // ZIP-based update: get latest release tag, then download
          console.log('📥 Kein Git verfügbar, verwende ZIP-Download...');
          const releaseResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
            {
              headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Fuchs-Metallbau-App' },
              timeout: 10000
            }
          );
          const latestTag = releaseResponse.data.tag_name;
          await downloadAndApplyUpdate(latestTag, projectRoot);
        }

        // Install dependencies
        console.log('📦 Updating backend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'backend'), timeout: 120000 });

        console.log('📦 Updating frontend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend'), timeout: 120000 });

        // Build frontend
        console.log('🏗️  Building frontend...');
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend'), timeout: 120000 });

        console.log('✅ Update completed! Restarting server...');
        process.exit(100);
      } catch (error) {
        console.error('❌ Update failed:', error.message);
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
 * Works with git, build-info.json, or pure GitHub API fallback
 */
const getGitInfo = async (req, res) => {
  try {
    const version = getCurrentVersion();
    const projectRoot = path.join(__dirname, '../../..');
    const buildInfoPath = path.join(__dirname, '../build-info.json');

    // Check if we're on a tag (only if git available)
    let currentTag = null;
    if (gitAvailable) {
      try {
        currentTag = execSync('git describe --tags --exact-match', {
          cwd: projectRoot,
          stdio: ['pipe', 'pipe', 'pipe']
        }).toString().trim();
      } catch (e) {
        // Not on a tag
      }
    }

    // Try to read from build-info.json first
    if (fs.existsSync(buildInfoPath)) {
      try {
        const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));

        let releaseNotes = null;
        if (currentTag) {
          try {
            const releaseResponse = await axios.get(
              `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${currentTag}`,
              { headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Fuchs-Metallbau-App' }, timeout: 10000 }
            );
            releaseNotes = releaseResponse.data.body;
          } catch (e) { /* ignore */ }
        }

        if (buildInfo.git) {
          return res.json({
            branch: buildInfo.git.branch,
            commit: buildInfo.git.commit,
            commitMessage: releaseNotes || buildInfo.git.commitMessage,
            commitDate: buildInfo.git.commitDate,
            version: version,
            buildDate: buildInfo.buildDate,
            releaseNotes: releaseNotes,
            isRelease: !!releaseNotes,
            source: 'build-info'
          });
        } else {
          return res.json({
            branch: 'release',
            commit: 'N/A',
            commitMessage: releaseNotes || `Release v${version}`,
            commitDate: buildInfo.buildDate,
            version: version,
            buildDate: buildInfo.buildDate,
            releaseNotes: releaseNotes,
            isRelease: !!releaseNotes,
            source: 'build-info-release'
          });
        }
      } catch (parseError) {
        console.warn('Failed to parse build-info.json:', parseError.message);
      }
    }

    // Try git commands if available
    if (gitAvailable) {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot }).toString().trim();
        const commit = execSync('git rev-parse --short HEAD', { cwd: projectRoot }).toString().trim();
        const commitMessage = execSync('git log -1 --pretty=%B', { cwd: projectRoot }).toString().trim();
        const commitDate = execSync('git log -1 --pretty=%cd --date=iso', { cwd: projectRoot }).toString().trim();

        let releaseNotes = null;
        if (currentTag) {
          try {
            const releaseResponse = await axios.get(
              `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${currentTag}`,
              { headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Fuchs-Metallbau-App' }, timeout: 10000 }
            );
            releaseNotes = releaseResponse.data.body;
          } catch (e) { /* ignore */ }
        }

        return res.json({
          branch,
          commit,
          commitMessage: releaseNotes || commitMessage,
          commitDate,
          version,
          releaseNotes: releaseNotes,
          isRelease: !!releaseNotes,
          source: 'git'
        });
      } catch (gitError) {
        // Git commands failed, fall through to API fallback
      }
    }

    // Fallback: Use GitHub API to get info about current version
    let releaseInfo = null;
    try {
      // Try to find a release matching current version
      const releaseResponse = await axios.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/v${version}`,
        { headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Fuchs-Metallbau-App' }, timeout: 10000 }
      );
      releaseInfo = releaseResponse.data;
    } catch (e) {
      // No release found for this version
    }

    res.json({
      branch: releaseInfo ? 'release' : 'unknown',
      commit: 'N/A',
      commitMessage: releaseInfo ? (releaseInfo.body || `Release v${version}`) : `Version ${version}`,
      commitDate: releaseInfo ? releaseInfo.published_at : null,
      version: version,
      buildDate: releaseInfo ? releaseInfo.published_at : null,
      releaseNotes: releaseInfo ? releaseInfo.body : null,
      isRelease: !!releaseInfo,
      source: 'github-api'
    });
  } catch (error) {
    console.error('Error getting git info:', error.message);

    res.json({
      branch: 'unknown',
      commit: 'N/A',
      commitMessage: `Version ${getCurrentVersion()}`,
      commitDate: null,
      version: getCurrentVersion(),
      releaseNotes: null,
      isRelease: false,
      source: 'fallback'
    });
  }
};

/**
 * Trigger update from specific branch (developer only)
 * Requires password authentication and git
 */
const triggerBranchUpdate = async (req, res) => {
  try {
    const { branch, password } = req.body;

    if (!branch || !password) {
      return res.status(400).json({ error: 'Branch und Passwort erforderlich' });
    }

    if (password !== 'netrock!') {
      return res.status(403).json({ error: 'Falsches Entwickler-Passwort' });
    }

    if (!gitAvailable) {
      return res.status(400).json({ error: 'Branch-Update benötigt Git. Bitte Git installieren oder Versions-Update verwenden.' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    res.json({
      success: true,
      message: `Update von Branch "${branch}" wird durchgeführt. Server startet neu...`
    });

    setTimeout(async () => {
      try {
        console.log(`🔄 Starting branch update from "${branch}"...`);

        try { execSync('git stash', { cwd: projectRoot }); } catch (e) { /* ignore */ }

        execSync('git fetch origin', { cwd: projectRoot });
        execSync(`git checkout ${branch}`, { cwd: projectRoot });
        execSync(`git pull origin ${branch}`, { cwd: projectRoot });

        console.log('📦 Updating backend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'backend'), timeout: 120000 });

        console.log('📦 Updating frontend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend'), timeout: 120000 });

        console.log('🏗️  Building frontend...');
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend'), timeout: 120000 });

        console.log(`✅ Branch update from "${branch}" completed! Restarting server...`);
        process.exit(100);
      } catch (error) {
        console.error('❌ Branch update failed:', error.message);
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
 * Get all tags (versions) - uses git if available, otherwise GitHub API
 */
const getTags = async (req, res) => {
  try {
    const currentVersion = getCurrentVersion();

    if (gitAvailable) {
      // Git-based tag loading
      const projectRoot = path.join(__dirname, '../../..');

      try {
        execSync('git fetch origin --tags', { cwd: projectRoot, timeout: 30000 });
      } catch (e) {
        // Continue even if fetch fails (offline mode)
      }

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

      return res.json({ tags, currentVersion });
    }

    // Fallback: Use GitHub API to get tags
    console.log('📡 Lade Tags über GitHub API...');

    // Get tags from GitHub API
    const tagsResponse = await axios.get(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`,
      {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Fuchs-Metallbau-App' },
        params: { per_page: 50 },
        timeout: 10000
      }
    );

    // Also get releases for dates and descriptions
    let releasesMap = {};
    try {
      const releasesResponse = await axios.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
        {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Fuchs-Metallbau-App' },
          params: { per_page: 50 },
          timeout: 10000
        }
      );
      for (const release of releasesResponse.data) {
        releasesMap[release.tag_name] = {
          date: release.published_at,
          message: release.name || ''
        };
      }
    } catch (e) {
      // Continue without release info
    }

    // Sort tags by version (newest first)
    const tags = tagsResponse.data
      .map(tag => ({
        name: tag.name,
        date: releasesMap[tag.name]?.date || '',
        message: releasesMap[tag.name]?.message || ''
      }))
      .sort((a, b) => {
        const vA = a.name.replace(/^v/, '');
        const vB = b.name.replace(/^v/, '');
        return compareVersions(vB, vA); // Newest first
      });

    res.json({ tags, currentVersion });
  } catch (error) {
    console.error('Error fetching tags:', error.message);
    res.status(500).json({ error: 'Fehler beim Laden der Versionen' });
  }
};

/**
 * Get all remote branches (requires dev password and git)
 */
const getBranches = async (req, res) => {
  try {
    const { password } = req.query;

    if (!password || password !== 'netrock!') {
      return res.status(403).json({ error: 'Falsches Entwickler-Passwort' });
    }

    if (!gitAvailable) {
      return res.status(400).json({ error: 'Branch-Zugriff benötigt Git. Bitte Git installieren.' });
    }

    const projectRoot = path.join(__dirname, '../../..');

    try {
      execSync('git fetch origin --prune', { cwd: projectRoot, timeout: 30000 });
    } catch (e) {
      // Continue even if fetch fails
    }

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

    res.json({ branches, currentBranch });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Branches' });
  }
};

/**
 * Trigger update to a specific version (tag)
 * Uses git checkout if available, otherwise downloads ZIP from GitHub
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

        if (gitAvailable) {
          // Git-based version update
          try { execSync('git stash', { cwd: projectRoot }); } catch (e) { /* ignore */ }
          execSync('git fetch origin --tags', { cwd: projectRoot, timeout: 30000 });
          execSync('git checkout main', { cwd: projectRoot });
          execSync('git pull origin main', { cwd: projectRoot });
          execSync(`git checkout "${tag}"`, { cwd: projectRoot });

          // Also update package.json version for consistency
          updatePackageJsonVersion(projectRoot, tag);
        } else {
          // ZIP-based version update
          console.log('📥 Kein Git verfügbar, verwende ZIP-Download...');
          await downloadAndApplyUpdate(tag, projectRoot);
        }

        // Install dependencies
        console.log('📦 Updating backend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'backend'), timeout: 120000 });
        console.log('📦 Updating frontend dependencies...');
        execSync('npm install', { cwd: path.join(projectRoot, 'frontend'), timeout: 120000 });

        // Build frontend
        console.log('🏗️  Building frontend...');
        execSync('npm run build', { cwd: path.join(projectRoot, 'frontend'), timeout: 120000 });

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

/**
 * Get all GitHub releases with release notes
 */
const getReleases = async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Fuchs-Metallbau-App'
        },
        params: { per_page: 20 },
        timeout: 10000
      }
    );

    const releases = response.data.map(release => ({
      tagName: release.tag_name,
      name: release.name || release.tag_name,
      body: release.body || '',
      publishedAt: release.published_at,
      htmlUrl: release.html_url
    }));

    res.json({ releases });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.json({ releases: [] });
    }
    console.error('Error fetching releases:', error.message);
    res.status(500).json({ error: 'Fehler beim Laden der Release-Informationen' });
  }
};

module.exports = {
  getLatestVersion,
  triggerUpdate,
  triggerBranchUpdate,
  triggerVersionUpdate,
  getGitInfo,
  getTags,
  getBranches,
  getReleases
};
