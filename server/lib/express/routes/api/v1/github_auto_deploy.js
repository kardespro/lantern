const bodyParser = require('body-parser');
const crypto = require('node:crypto');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

module.exports = {
  post: [
    bodyParser.json(),
    async (request, response) => {
      const modifiedServerFiles = request.body.commits.reduce((acc, commit) => {
        commit.modified.filter(file => file.startsWith('server/')).forEach(file => acc.push(file));
        commit.added.filter(file => file.startsWith('server/')).forEach(file => acc.push(file));
        commit.removed.filter(file => file.startsWith('server/')).forEach(file => acc.push(file));
        
        return acc;
      }, []);

      if (!modifiedServerFiles.length) return response.sendError('No server files modified', 400);

      const signature = request.headers['x-hub-signature-256'];
      if (!signature) return response.sendError('No signature provided', 400);

      const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
      hmac.update(JSON.stringify(request.body));

      const digest = Buffer.from('sha256=' + hmac.digest('hex'), 'utf8');
      const hash = Buffer.from(signature, 'utf8');
      
      try {
        if (hash.length !== digest.length || !crypto.timingSafeEqual(digest, hash)) return response.sendError('Invalid signature', 403);
      } catch (error) {
        return response.sendError('Invalid signature', 403);
      }

      try {
        const { stdout, stderr } = await exec('git pull');
        logger.info(stdout);
        if (stderr) logger.info(stderr);

        logger.info('Pull successful.');
        
        const isFlagPresent = flag => request.body.commits.some(commit => commit.message.includes(`flags:${flag}`));

        if (isFlagPresent('installDependencies')) {
          logger.info('There are requests to install dependencies. Installing..');

          const { stdout, stderr } = await exec('pnpm install');
          logger.info(stdout);
          if (stderr) logger.info(stderr);
        }

        if (isFlagPresent('installGlobalDependencies')) {
          logger.info('There are requests to install global dependencies. Installing..');

          const shouldBeInstalled = request.body.commits.filter(commit => commit.message.includes('flags:installGlobalDependencies')).map(commit => {
            const dependencies = commit.message.match(/installGlobalDependencies:([\w\s-]+)/)[1].split(' ');
            return dependencies;
          }).flat();

          const { stdout, stderr } = await exec(`npm install -g ${shouldBeInstalled.join(' ')}`);
          logger.info(stdout);
          if (stderr) logger.info(stderr);
        }

        logger.info('Auto deploy successful. Exiting process..');
        response.sendStatus(201);
        process.exit(0);
      } catch (error) {
        logger.error('Error while pulling from GitHub:', error);
        response.sendError(`Error while pulling from GitHub:\n${error}`, 500);
      }
    }
  ]
};
