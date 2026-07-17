const GITHUB_REPO = 'AxmadjonTeacher/SmoothCut';

/**
 * GitHub's /releases/latest/download/<filename> permalink always resolves to
 * whatever the newest published release contains — stable across version
 * bumps ONLY because electron-builder.yml's artifactName omits ${version}.
 */
export const DOWNLOAD_LINKS = {
  mac: `https://github.com/${GITHUB_REPO}/releases/latest/download/SmoothCut-mac-arm64.dmg`,
  windows: `https://github.com/${GITHUB_REPO}/releases/latest/download/SmoothCut-win-x64-setup.exe`,
};

export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const DEVELOPER_URL = 'https://www.instagram.com/axmadjon.dev/';
