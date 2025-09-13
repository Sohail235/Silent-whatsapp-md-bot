const { exec } = require('child_process');

const modules = [

    '@vitalets/google-translate-api'

];

modules.forEach(mod => {

    console.log(`Installing ${mod}...`);

    exec(`npm install ${mod}`, (error, stdout, stderr) => {

        if (error) {

            console.error(`Error installing ${mod}:`, error);

            return;

        }

        console.log(stdout);

        console.error(stderr);

        console.log(`${mod} installed successfully!`);

    });

});