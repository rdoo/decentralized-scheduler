const path = require('path');
const fs = require('fs');

const RunNodeWebpackPlugin = require('run-node-webpack-plugin');

const nodeModules = {};
fs.readdirSync('node_modules')
    .filter(moduleName => moduleName !== '.bin')
    .forEach(moduleName => (nodeModules[moduleName] = 'commonjs ' + moduleName));

module.exports = (env, argv) => {
    const IS_PRODUCTION_BUILD = argv.mode === 'production';

    const webpackPlugins = [];

    if (!IS_PRODUCTION_BUILD) {
        webpackPlugins.push(new RunNodeWebpackPlugin());
    }

    return {
        target: 'node',
        externals: nodeModules,
        node: {
            __filename: false,
            __dirname: false
        },
        entry: path.join(__dirname, 'src', 'index.ts'),
        output: {
            path: path.join(__dirname, 'build'),
            filename: 'bundle.js'
        },
        resolve: {
            extensions: ['.ts']
        },
        module: {
            rules: [
                {
                    test: /client.ts$/,
                    use: [{ loader: 'raw-loader' }, { loader: 'uglify-es-loader' }]
                },
                {
                    test: /style.css$/,
                    use: [{ loader: 'raw-loader' }]
                },
                { test: /\.ts$/, use: [{ loader: 'awesome-typescript-loader' }] },
                { test: /\.html$/, use: [{ loader: 'html-loader', options: { interpolate: 'require', minimize: true, removeComments: false, minifyCSS: true } }] }
            ]
        },
        plugins: webpackPlugins
    };
};
