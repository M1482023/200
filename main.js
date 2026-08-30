const { Actor } = require('apify');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

async function getWebTorrent() {
    const imported = await import('webtorrent');
    return imported.default || imported;
}

function zipDirectory(sourceDir, outputFilePath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

Actor.main(async () => {
    const input = await Actor.getInput();
    const magnetUrl = input?.magnetUrl;
    const clientId = input?.clientId;
    const clientSecret = input?.clientSecret;
    const refreshToken = input?.refreshToken;
    const folderId = input?.folderId;

    if (!magnetUrl || !magnetUrl.startsWith('magnet:?')) {
        throw new Error('Invalid magnet URL. It must start with magnet:?');
    }

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Google Drive credentials: clientId, clientSecret, refreshToken are required.');
    }

    const workDir = path.join(process.cwd(), 'tmp', String(Date.now()));
    const downloadDir = path.join(workDir, 'download');
    const zipDir = path.join(workDir, 'zip');
    const zipPath = path.join(zipDir, 'download.zip');

    fs.mkdirSync(downloadDir, { recursive: true });
    fs.mkdirSync(zipDir, { recursive: true });

    console.log('Starting torrent download...');
    const WebTorrent = await getWebTorrent();
    const client = new WebTorrent();

    const torrent = client.add(magnetUrl, { path: downloadDir });

    await new Promise((resolve, reject) => {
        torrent.on('done', () => {
            console.log('Torrent download finished.');
            resolve();
        });

        torrent.on('error', (err) => {
            reject(new Error(`Torrent error: ${err.message || err}`));
        });
    });

    console.log('Creating ZIP archive...');
    await zipDirectory(downloadDir, zipPath);

    const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret
    );

    oauth2Client.setCredentials({
        refresh_token: refreshToken
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const metadata = {
        name: path.basename(zipPath)
    };

    if (folderId) {
        metadata.parents = [folderId];
    }

    console.log('Uploading ZIP to Google Drive...');
    const response = await drive.files.create({
        resource: metadata,
        media: {
            mimeType: 'application/zip',
            body: fs.createReadStream(zipPath)
        },
        fields: 'id,name,webViewLink'
    });

    const result = {
        magnetUrl,
        fileId: response.data.id,
        fileName: response.data.name,
        webViewLink: response.data.webViewLink || null,
        folderId: folderId || null,
        zipPath
    };

    await Actor.pushData(result);

    console.log('Upload complete.');
    console.log(JSON.stringify(result, null, 2));

    await Actor.setValue('OUTPUT', result);

    client.destroy();
});
