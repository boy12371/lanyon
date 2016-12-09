// https://github.com/petehunt/webpack-howto/blob/master/README.md#8-optimizing-common-code
// https://www.jonathan-petitcolas.com/2016/08/12/plugging-webpack-to-jekyll-powered-pages.html
// https://webpack.github.io/docs/configuration.html#resolve-alias
// https://github.com/HenrikJoreteg/hjs-webpack
// http://webpack.github.io/docs/webpack-dev-middleware.html
// http://stackoverflow.com/a/28989476/151666
// https://github.com/webpack/webpack-dev-server/issues/97#issuecomment-70388180
// https://webpack.github.io/docs/hot-module-replacement.html
// https://github.com/css-modules/webpack-demo/issues/8#issuecomment-133922019
// https://github.com/gowravshekar/font-awesome-webpack
// https://webpack.github.io/docs/code-splitting.html#split-app-and-vendor-code
// https://medium.com/@okonetchnikov/long-term-caching-of-static-assets-with-webpack-1ecb139adb95#.w0elv8n7o
var _ = require('lodash')
var path = require('path')
var utils = require('./utils')
var fs = require('fs')
var ExtractTextPlugin = require('extract-text-webpack-plugin')
var webpack = require('webpack')
var webpackDevMiddleware = require('webpack-dev-middleware')
var webpackHotMiddleware = require('webpack-hot-middleware')
var BowerWebpackPlugin = require('bower-webpack-plugin')
var Visualizer = require('webpack-visualizer-plugin')
var yaml = require('js-yaml')
var AssetsPlugin = require('assets-webpack-plugin')
var WebpackMd5Hash = require('webpack-md5-hash')
var runtime = {}

runtime.lanyonDir = __dirname
runtime.lanyonEnv = process.env.LANYON_ENV || 'development'
runtime.lanyonPackageFile = path.join(runtime.lanyonDir, 'package.json')
var lanyonPackage = require(runtime.lanyonPackageFile)
runtime.lanyonVersion = lanyonPackage.version

runtime.trace = process.env.LANYON_TRACE === '1'
runtime.publicPath = '/assets/build/'

runtime.rubyProvidersOnly = (process.env.LANYON_ONLY || '')
runtime.rubyProvidersSkip = (process.env.LANYON_SKIP || '').split(/\s+/)

runtime.lanyonReset = process.env.LANYON_RESET === '1'
runtime.onTravis = process.env.TRAVIS === 'true'
runtime.ghPagesEnv = {
  GHPAGES_URL: process.env.GHPAGES_URL,
  GHPAGES_BOTNAME: process.env.GHPAGES_BOTNAME,
  GHPAGES_BOTEMAIL: process.env.GHPAGES_BOTEMAIL
}
runtime.isDev = runtime.lanyonEnv === 'development'
runtime.isHotLoading = runtime.isDev && ['serve', 'start'].indexOf(process.argv[2]) !== -1

runtime.projectDir = process.env.LANYON_PROJECT || process.env.PWD || process.cwd() // <-- symlinked npm will mess up process.cwd() and point to ~/code/lanyon

runtime.npmRoot = utils.upwardDirContaining('package.json', runtime.projectDir, 'lanyon')
if (!runtime.npmRoot) {
  console.error('--> Unable to determine non-lanyon npmRoot, falling back to ' + runtime.projectDir)
  runtime.npmRoot = runtime.projectDir
}
runtime.gitRoot = utils.upwardDirContaining('.git', runtime.npmRoot)

runtime.projectPackageFile = path.join(runtime.npmRoot, 'package.json')
try {
  var projectPackage = require(runtime.projectPackageFile)
} catch (e) {
  projectPackage = {}
}

runtime.gems = _.defaults(_.get(projectPackage, 'lanyon.gems') || {}, _.get(lanyonPackage, 'lanyon.gems'))
runtime = _.defaults(projectPackage.lanyon || {}, lanyonPackage.lanyon, runtime)

try {
  runtime.projectDir = fs.realpathSync(runtime.projectDir)
} catch (e) {
  runtime.projectDir = fs.realpathSync(runtime.gitRoot + '/' + runtime.projectDir)
}

runtime.cacheDir = path.join(runtime.projectDir, '.lanyon')
runtime.binDir = path.join(runtime.cacheDir, 'bin')
runtime.recordsPath = path.join(runtime.cacheDir, 'records.json')
runtime.assetsSourceDir = path.join(runtime.projectDir, 'assets')
runtime.assetsBuildDir = path.join(runtime.assetsSourceDir, 'build')
runtime.contentBuildDir = path.join(runtime.projectDir, '_site')

// Set prerequisite defaults
for (var name in runtime.prerequisites) {
  if (!runtime.prerequisites[name].exeSuffix) {
    runtime.prerequisites[name].exeSuffix = ''
  }
  if (!runtime.prerequisites[name].exe) {
    runtime.prerequisites[name].exe = name
  }
  if (!runtime.prerequisites[name].versionCheck) {
    runtime.prerequisites[name].versionCheck = runtime.prerequisites[name].exe + ' -v'
  }
}

// Determine rubyProvider sources to traverse
var allApps = [ 'system', 'docker', 'rbenv', 'rvm', 'ruby-shim' ]
if (runtime.rubyProvidersOnly === 'auto-all') {
  runtime.rubyProvidersOnly = ''
}

if (runtime.rubyProvidersOnly) {
  runtime.rubyProvidersSkip = []
  allApps.forEach(function (app) {
    if (app !== runtime.rubyProvidersOnly) {
      runtime.rubyProvidersSkip.push(app)
    }
  })
}

function getFilename (extension, isChunk, isContent) {
  var filename = '[name].' + extension

  if (!runtime.isDev) {
    filename = '[name].[chunkhash].' + extension
    if (isContent) {
      filename = '[name].[contenthash].' + extension
    }
  }

  if (isChunk) {
    filename = '[name].[chunkhash].[id].chunk.' + extension
  }

  return filename
}

var cfg = {
  webpack: {
    entry: (function entries () {
      var entries = {}
      runtime.entries.forEach(function (entry) {
        entries[entry] = [ path.join(runtime.assetsSourceDir, entry + '.js') ]

        if (entry === 'app' && runtime.isDev) {
          entries[entry].unshift('webpack-hot-middleware/client')
        }
      })

      if (runtime.common) {
        // https://webpack.github.io/docs/code-splitting.html#split-app-and-vendor-code
        entries.common = runtime.common
      }

      return entries
    }()),
    node: {
      fs: 'empty'
    },
    target: 'web',
    output: {
      publicPath: runtime.publicPath,
      path: runtime.assetsBuildDir,
      filename: getFilename('js'),
      chunkFilename: getFilename('js', true),
      cssFilename: getFilename('css')
    },
    devtool: 'eval-cheap-source-map',
    // devtool: 'source-map',
    module: {
      loaders: (function plugins () {
        var loaders = [
          {
            test: /\.css$/,
            loader: 'style!css?sourceMap!resolve-url'
          }, {
            test: /\.woff(\?v=\d+\.\d+\.\d+)?$/,
            loader: 'url?limit=10000&mimetype=application/font-woff'
          }, {
            test: /\.woff2(\?v=\d+\.\d+\.\d+)?$/,
            loader: 'url?limit=10000&mimetype=application/font-woff'
          }, {
            test: /\.ttf(\?v=\d+\.\d+\.\d+)?$/,
            loader: 'url?limit=10000&mimetype=application/octet-stream'
          }, {
            test: /\.eot(\?v=\d+\.\d+\.\d+)?$/,
            loader: 'file'
          }, {
            test: /\.cur(\?v=\d+\.\d+\.\d+)?$/,
            loader: 'file'
          }, {
            test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
            loader: 'url?limit=10000&mimetype=image/svg+xml'
          },
          {
            test: /\.js$/,
            loaders: [ 'jsx', 'babel' ],
            exclude: /(node_modules|bower_components|vendor)/
          },
          {
            test: /\.coffee$/,
            loader: 'coffee',
            exclude: /(node_modules|bower_components|vendor)/
          },
          {
            test: /\.(png|gif|jpe?g)$/,
            loader: 'url?limit=8096',
            exclude: /(node_modules|vendor)/
          },
          {
            // https://github.com/webpack/webpack/issues/512
            test: /[\\/](bower_components)[\\/]modernizr[\\/]modernizr\.js$/,
            loader: 'imports?this=>window!exports?window.Modernizr'
          },
          {
            test: /[\\/](bower_components)[\\/]svgeezy[\\/]svgeezy\.js$/,
            loader: 'imports?this=>window!exports?svgeezy'
          },
          {
            // https://www.techchorus.net/blog/using-sass-version-of-bootstrap-with-webpack/
            test: /[\\/](bower_components)[\\/]bootstrap-sass[\\/]assets[\\/]javascripts[\\/]/,
            loader: 'imports?jQuery=jquery,$=jquery,this=>window'
          },
          {
            test: /[\\/]jquery\..*\.js$/,
            loader: 'imports?jQuery=jquery,$=jquery,this=>window'
          }
        ]

        if (runtime.isDev) {
          loaders.push({
            test: /\.scss$/,
            loader: 'style!css!resolve-url?root=' + runtime.projectDir + '!sass?sourceMap&sourceComments',
            exclude: /(node_modules|bower_components|vendor)/
          })
          loaders.push({
            test: /\.less$/,
            loader: 'style!css!resolve-url?root=' + runtime.projectDir + '!less?sourceMap&sourceComments',
            exclude: /(node_modules|bower_components|vendor)/
          })
        } else {
          loaders.push({
            test: /\.scss$/,
            loader: ExtractTextPlugin.extract('css!resolve-url?root=' + runtime.projectDir + '!sass?sourceMap'),
            exclude: /(node_modules|bower_components|vendor)/
          })
          loaders.push({
            test: /\.less$/,
            loader: ExtractTextPlugin.extract('css?sourceMap!resolve-url?root=' + runtime.projectDir + '!less?sourceMap'),
            exclude: /(node_modules|bower_components|vendor)/
          })
        }

        return loaders
      }())
    },
    plugins: (function plugins () {
      var plugins = [
        new BowerWebpackPlugin(),
        new webpack.ProvidePlugin({
          _: 'lodash',
          $: 'jquery',
          jQuery: 'jquery'
        })
      ]

      if (runtime.isDev) {
        plugins.push(new webpack.HotModuleReplacementPlugin())
      } else {
        plugins.push(new ExtractTextPlugin(getFilename('css'), {
          allChunks: true
        }))
      }

      if (runtime.common) {
        plugins.push(new webpack.optimize.CommonsChunkPlugin(/* chunkName= */'common', /* filename= */getFilename('js')))
      }

      if (runtime.statistics) {
        var fullpathStatistics = runtime.assetsBuildDir + '/' + runtime.statistics
        if (runtime.isDev) {
          console.log('--> Cannot write statistics to "' + fullpathStatistics + '" in dev mode. Create a production build via LANYON_ENV=production. ')
        } else {
          console.log('--> Will write statistics to "' + fullpathStatistics + '"')
          // @todo: Once Vizualizer supports multiple entries, add support for that here
          // https://github.com/chrisbateman/webpack-visualizer/issues/5
          plugins.push(new Visualizer({
            filename: runtime.statistics
          }))
        }
      }

      plugins.push(new AssetsPlugin({
        filename: 'jekyll.lanyon_assets.yml',
        path: runtime.cacheDir,
        processOutput: function (assets) {
          console.log('--> Writing asset manifest to: "' + runtime.cacheDir + '/jekyll.lanyon_assets.yml"')
          return yaml.safeDump({lanyon_assets: assets})
        }
      }))
      plugins.push(new WebpackMd5Hash())
      plugins.push(new webpack.optimize.OccurenceOrderPlugin())

      return plugins
    }()),
    resolveLoader: {
      root: [
        path.join(runtime.lanyonDir, 'node_modules'),
        path.join(runtime.projectDir, 'node_modules')
      ]
    },
    recordsPath: runtime.recordsPath,
    resolve: {
      root: [
        path.resolve(runtime.assetsSourceDir),
        path.resolve(runtime.assetsSourceDir) + '/bower_components',
        path.resolve(runtime.projectDir) + '/node_modules',
        path.resolve(runtime.lanyonDir) + '/node_modules'
      ]
    },
    uglify: {
      compress: {
        warnings: false
      },
      output: {
        comments: true
      },
      sourceMap: false
    }
  }
}

if (runtime.isHotLoading) {
  var bundler = webpack(cfg.webpack)
}

cfg.browsersync = {
  server: {
    port: runtime.ports.content,
    baseDir: runtime.contentBuildDir,
    middleware: (function middlewares () {
      var middlewares = []

      if (runtime.isHotLoading) {
        middlewares.push(webpackDevMiddleware(bundler, {
          publicPath: runtime.publicPath,
          hot: true,
          inline: true,
          stats: { colors: true }
        }))
        middlewares.push(webpackHotMiddleware(bundler))
      }

      if (!middlewares.length) {
        return false
      }
      return middlewares
    }())
  },
  watchOptions: {
    ignoreInitial: true,
    ignored: [
      // no need to watch '*.js' here, webpack will take care of it for us,
      // including full page reloads if HMR won't work
      '*.js',
      '.git',
      'assets/build',
      '.lanyon'
    ]
  },
  reloadDelay: 200,
  files: runtime.contentBuildDir
}

cfg.jekyll = {
  exclude: [
    'node_modules',
    'env.sh',
    'env.*.sh',
    '.env.sh',
    '.env.*.sh',
    '.lanyon'
  ]
}

cfg.nodemon = {
  onChangeOnly: true,
  verbose: true,
  watch: runtime.projectDir,
  ignore: [
    '.lanyon/*',
    'env.sh',
    'env.*.sh',
    '.env.sh',
    '.env.*.sh',
    'assets/*',
    'vendor/**',
    'node_modules/*',
    '_site/*'
  ],
  ext: [
    'htm',
    'html',
    'jpg',
    'json',
    'md',
    'png',
    'sh',
    'yml'
  ].join(',')
}

cfg.runtime = runtime

module.exports = cfg
