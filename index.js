const path = require('path');
const co = require('co');
const { exec, spawn } = require('child_process');
const ProgressPromise = require('progress-promise');

const getMetaData = inputPath => new Promise((resolve, reject) => {
  exec(`ffmpeg -hide_banner -i ${inputPath}`, (err, stderr, stdout) => {
    const metaData = {
      duration: null,
      width: null,
      height: null,
      fps: null,
    };

    let rotate = 0;
    let tmpWidth = null;
    let tmpHeight = null;

    stdout.split(/[\n\r]/g).filter(line => /^(Duration|Stream.+Video|rotate)/.test(line.trim())).forEach((l) => {
      const line = l.trim();

      if (/^Duration/.test(line)) {
        metaData.duration = line.match(/^Duration: (.+?),/)[1].split(':').reduce((preview, current, index) => (+current * (60 ** (2 - index))) + preview, 0);
      } else if (/^rotate/.test(line)) {
        rotate = +line.split(':')[1];
      } else {
        const tmp = line.replace(/\(.+?\)/g, '').split(',');
        const size = tmp[2].trim().split(' ')[0].split('x');
        tmpWidth = +size[0];
        tmpHeight = +size[1];
        const fpsText = tmp.find(t => /fps/.test(t));
        metaData.fps = fpsText ? +fpsText.trim().split(' ')[0] : 30;
      }
    });

    metaData.rotate = rotate;

    if (rotate % 180 === 0) {
      metaData.width = tmpWidth;
      metaData.height = tmpHeight;
    } else {
      metaData.width = tmpHeight;
      metaData.height = tmpWidth;
    }

    if (metaData.duration > 0) resolve(metaData);
    else reject(new Error('Invalid data.'));
  });
});

module.exports = {
  getMetaData,
  transcode: ({ input, output, metaData, size, fps, cwd }) => new ProgressPromise((resolve, reject, progress) => {
    co(function* () {
      const { width, height, duration } = metaData || (yield getMetaData(input));
      const MAX_LENGTH = size || Math.max(width, height);

      const transVideo = spawn('ffmpeg', ['-i', input, '-q:v', 5, '-r', fps, '-threads', 0, '-vf', `scale=w=${MAX_LENGTH}:h=${MAX_LENGTH}:force_original_aspect_ratio=decrease`, path.join(output, '%d.jpg')], { cwd });
      transVideo.stderr.setEncoding('utf8');
      transVideo.stderr.on('data', (data) => {
        if (/^frame=/.test(data)) {
          progress(Math.min(0.999, +data.match(/^frame=.+?(\d+)/)[1] / (duration * fps)));
        }
      });

      transVideo.on('error', (err) => {
        reject(err);
      });

      transVideo.on('close', () => {
        progress(1);
        resolve();
      });
    });
  }),
};
