#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Reverse Engineer GitHub Repository
 * Analyzes code structure, dependencies, and architecture
 */

class GitHubReverseEngineer {
  constructor(repoUrl) {
    this.repoUrl = repoUrl;
    this.repoName = repoUrl.split('/').pop().replace('.git', '');
    this.localPath = path.join(process.cwd(), this.repoName);
  }

  async clone() {
    console.log(`🔍 Cloning ${this.repoUrl}...`);
    try {
      execSync(`git clone --depth 1 ${this.repoUrl} ${this.localPath}`, {
        stdio: 'inherit'
      });
    } catch (e) {
      console.error('Clone failed:', e.message);
    }
  }

  analyzeStructure() {
    console.log('\n📁 Analyzing repository structure...');
    const structure = {
      root: this.localPath,
      files: [],
      directories: [],
      stats: {}
    };

    const walk = (dir, depth = 0) => {
      if (depth > 3 || dir.includes('node_modules') || dir.includes('.git')) return;

      try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          const rel = path.relative(this.localPath, filePath);

          if (stat.isDirectory()) {
            structure.directories.push(rel);
            walk(filePath, depth + 1);
          } else {
            structure.files.push(rel);
          }
        });
      } catch (e) {
        // Skip permission errors
      }
    };

    walk(this.localPath);
    return structure;
  }

  analyzeDependencies() {
    console.log('\n📦 Analyzing dependencies...');
    const deps = {};

    // Check package.json
    const pkgPath = path.join(this.localPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        deps.npm = {
          dependencies: pkg.dependencies || {},
          devDependencies: pkg.devDependencies || {},
          scripts: pkg.scripts || {}
        };
      } catch (e) {
        console.error('Failed to parse package.json');
      }
    }

    // Check requirements.txt (Python)
    const reqPath = path.join(this.localPath, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      try {
        deps.python = fs.readFileSync(reqPath, 'utf8').split('\n').filter(l => l.trim());
      } catch (e) {
        console.error('Failed to parse requirements.txt');
      }
    }

    // Check go.mod
    const goModPath = path.join(this.localPath, 'go.mod');
    if (fs.existsSync(goModPath)) {
      try {
        deps.go = fs.readFileSync(goModPath, 'utf8');
      } catch (e) {
        console.error('Failed to parse go.mod');
      }
    }

    return deps;
  }

  analyzeLanguages() {
    console.log('\n🔤 Detecting programming languages...');
    const extensions = {};

    const walk = (dir) => {
      try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          if (file.startsWith('.')) return;
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git')) {
            walk(filePath);
          } else if (stat.isFile()) {
            const ext = path.extname(file);
            extensions[ext] = (extensions[ext] || 0) + 1;
          }
        });
      } catch (e) {
        // Skip
      }
    };

    walk(this.localPath);
    return extensions;
  }

  analyzeREADME() {
    console.log('\n📖 Extracting README...');
    const readmePath = path.join(this.localPath, 'README.md');

    if (fs.existsSync(readmePath)) {
      try {
        return fs.readFileSync(readmePath, 'utf8').slice(0, 2000);
      } catch (e) {
        return 'Could not read README';
      }
    }
    return 'No README found';
  }

  generateReport() {
    console.log('\n📊 Generating reverse engineering report...');

    const report = {
      repository: this.repoUrl,
      timestamp: new Date().toISOString(),
      structure: this.analyzeStructure(),
      dependencies: this.analyzeDependencies(),
      languages: this.analyzeLanguages(),
      readme: this.analyzeREADME(),
      insights: {
        totalFiles: 0,
        primaryLanguage: 'unknown',
        isMonorepo: false,
        hasCICD: false,
        hasTests: false,
        hasDocker: false
      }
    };

    // Calculate insights
    report.insights.totalFiles = report.structure.files.length;

    const langs = Object.entries(report.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    report.insights.primaryLanguage = langs[0]?.[0] || 'unknown';

    report.insights.isMonorepo = report.structure.directories.some(d =>
      d.includes('packages') || d.includes('modules') || d.includes('apps')
    );

    report.insights.hasCICD = report.structure.files.some(f =>
      f.includes('.github') || f.includes('.gitlab-ci') || f.includes('.travis')
    );

    report.insights.hasTests = report.structure.files.some(f =>
      f.includes('test') || f.includes('spec')
    );

    report.insights.hasDocker = report.structure.files.some(f =>
      f.includes('Dockerfile') || f.includes('docker-compose')
    );

    return report;
  }

  async run() {
    await this.clone();
    const report = this.generateReport();

    // Save report
    const reportPath = path.join(process.cwd(), `${this.repoName}-analysis.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('\n✅ Analysis complete!');
    console.log(`📄 Report saved to: ${reportPath}`);

    return report;
  }
}

// CLI interface
if (require.main === module) {
  const repoUrl = process.argv[2];

  if (!repoUrl) {
    console.error('Usage: node reverse-engineer.js <github-url>');
    console.error('Example: node reverse-engineer.js https://github.com/user/repo');
    process.exit(1);
  }

  const engineer = new GitHubReverseEngineer(repoUrl);
  engineer.run().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

module.exports = GitHubReverseEngineer;
