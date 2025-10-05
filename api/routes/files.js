const { exec } = require('child_process');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const busboy = require('busboy');


const router = express.Router();

function executeCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stderr });
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

// curl -H "url: https://www.youtube.com/watch?v=wg8LfFX0rnQ" http://localhost:3000/url-to-mp3 --output cream.mp3
router.get('/url-to-mp3', async (req, res) => {
    // Get URL from header
    const url = req.headers['url'];
    if (!url) {
        return res.status(400).json({ error: 'Missing url header' });
    }
    console.log('Received URL from header:', url);

    // Run yt-dlp mp3 extract
    try  {
        let file_name = crypto.randomUUID();
        const result = await executeCommand(`yt-dlp -x --audio-format mp3 -o "./files/${file_name}.mp3" --proxy "socks5h://100.102.74.90:1080" ${url}`);
        console.log(result);

        // Return mp3
        const filePath = path.join(__dirname, `../files/${file_name}.mp3`);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.sendFile(filePath);
    }
    catch (err) {
        console.error('Error executing yt-dlp:', err);
        return res.status(500).json({ error: 'Failed to process the URL' });
    }

});


// curl -X POST http://localhost:3000/mp3-to-mid -F "mp3_file=@autumn.mp3" --output autumn.mid
router.post('/mp3-to-mid', (req, res) => {
    const bb = busboy({ headers: req.headers });
    let fileBuffer = null;
    let mp3_name = null;

    bb.on('file', (name, file, info) => {
        if (name === 'mp3_file') {
            mp3_name = info.filename;
            const chunks = [];

            file.on('data', (chunk) => {
                chunks.push(chunk);
            });

            file.on('end', () => {
                fileBuffer = Buffer.concat(chunks);
            });
        } else {
            file.resume(); // discard non-file fields
        }
    });

    bb.on('close', async () => {
        if (fileBuffer) {
            console.log(`Received file: ${mp3_name}, size: ${fileBuffer.length}`);
            try {
                const inputPath = path.join(__dirname, `../files/${mp3_name}`);
                fs.writeFileSync(inputPath, fileBuffer);
                mp3_name = mp3_name.substring(0, mp3_name.lastIndexOf('.'));
                const result = await executeCommand(`bash ./mp3-to-midi.sh ./files/${mp3_name}.mid`);
                const filePath = path.join(__dirname, `../files/${mp3_name}.mid`);
                res.sendFile(filePath);
            }
            catch (err) {
                console.error('Error executing mp3-to-midi.sh:', err);
                return res.status(500).json({ error: 'Failed to convert MP3 to MIDI' });
            }
        } else {
            res.status(400).json({ error: 'No file received' });
        }
    });

    req.pipe(bb);
});

// curl -X POST http://localhost:3000/mid-to-mp4 -F "mid_file=@autumn.mid" --output midivid.mp4
router.post('/mid-to-mp4', (req, res) => {
    const bb = busboy({ headers: req.headers });
    let fileBuffer = null;
    let midi_name = null;

    bb.on('file', (name, file, info) => {
        if (name === 'mid_file') {
            midi_name = info.filename;
            const chunks = [];

            file.on('data', (chunk) => {
                chunks.push(chunk);
            });

            file.on('end', () => {
                fileBuffer = Buffer.concat(chunks);
            });
        } else {
            file.resume(); // discard non-file fields
        }
    });

    bb.on('close', async () => {
        if (fileBuffer) {
            console.log(`Received file: ${midi_name}, size: ${fileBuffer.length}`);
            try {
                const inputPath = path.join(__dirname, `../files/${midi_name}`);
                fs.writeFileSync(inputPath, fileBuffer);
                midi_name = midi_name.substring(0, midi_name.lastIndexOf('.'));
                const result = await executeCommand(`bash ./export-mp4.sh ./files/${midi_name}.mid`);
                const filePath = path.join(__dirname, `../files/${midi_name}.mp4`);
                res.sendFile(filePath);
            }
            catch (err) {
                console.error('Error executing export-mp4.sh:', err);
                return res.status(500).json({ error: 'Failed to convert MIDI to MP4' });
            }
        } else {
            res.status(400).json({ error: 'No file received' });
        }
    });

    req.pipe(bb);
});

// New endpoint: combine url-to-mp3 and mp3-to-mid
// curl -H "url: https://www.youtube.com/watch?v=wg8LfFX0rnQ" http://localhost:3000/youtube-to-midi --output result.mid
router.get('/youtube-to-midi', async (req, res) => {
    // Accept URL only from header to match existing conventions
    const url = req.headers['url'];
    if (!url) {
        return res.status(400).json({ error: 'Missing url header (provide YouTube link in header "url")' });
    }

    // Optional cleanup query param: ?cleanup=true will remove produced .mid after send
    const cleanupMid = (req.query && (req.query.cleanup === 'true' || req.query.cleanup === '1')) ? true : false;

    console.log('Received URL for youtube-to-midi (header):', url, 'cleanupMid=', cleanupMid);

    // Generate a random filename to avoid collisions
    const fileName = crypto.randomUUID();
    const mp3Path = path.join(__dirname, `../files/${fileName}.mp3`);
    const midPath = path.join(__dirname, `../files/${fileName}.mid`);

    try {
        // Download audio as mp3
        await executeCommand(`yt-dlp -x --audio-format mp3 -o "./files/${fileName}.mp3" ${url}`);
        console.log(`Downloaded MP3 to ${mp3Path}`);

        // Convert mp3 to midi using the existing script
        await executeCommand(`bash ./mp3-to-midi.sh ./files/${fileName}.mid`);
        console.log(`Conversion to MIDI attempted for ${midPath}`);

        // Ensure MIDI exists
        if (!fs.existsSync(midPath)) {
            console.error('MIDI file not found after conversion:', midPath);
            return res.status(500).json({ error: 'MIDI not produced' });
        }

        // Stream the resulting MIDI file and optionally cleanup after it's sent
        res.setHeader('Content-Type', 'audio/mpeg');
        res.sendFile(midPath, (err) => {
            if (err) {
                console.error('Error sending MIDI file:', err);
                // Note: response may already be in error state; nothing more to do
            } else {
                console.log('MIDI file sent:', midPath);
                if (cleanupMid) {
                    try {
                        if (fs.existsSync(midPath)) {
                            fs.unlinkSync(midPath);
                            console.log('Cleaned up MIDI (cleanup=true):', midPath);
                        }
                    } catch (delErr) {
                        console.warn('Failed to cleanup MIDI file:', delErr);
                    }
                }
            }
        });
    }
    catch (err) {
        console.error('Error in youtube-to-midi:', err);
        return res.status(500).json({ error: 'Failed to convert YouTube URL to MIDI' });
    }
    finally {
        // Attempt to cleanup the downloaded MP3 to save space; ignore errors
        try {
            if (fs.existsSync(mp3Path)) {
                fs.unlinkSync(mp3Path);
                console.log('Cleaned up temporary MP3:', mp3Path);
            }
        } catch (cleanupErr) {
            console.warn('Failed to cleanup MP3 file:', cleanupErr);
        }
    }
});

module.exports = router;
