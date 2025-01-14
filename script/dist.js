#!/usr/bin/env node
/* eslint-disable no-console */
const globby = require('globby')
const cssstats = require('cssstats')
const postcss = require('postcss')
const loadConfig = require('postcss-load-config')
const {remove, mkdirp, readFile, writeFile} = require('fs-extra')
const {dirname, join} = require('path')

const inDir = 'src'
const outDir = 'dist'
const statsDir = join(outDir, 'stats')
const encoding = 'utf8'

// Bundle paths are normalized in getPathName() using dirname() and then
// replacing any slashes with hyphens, but some bundles need to be
// special-cased. Keys in this object are the path minus the "src/" prefix,
// and values are the bundle file base name. ("primer" produces
// "dist/primer.css", etc.)
const bundleNames = {
  'index.scss': 'primer'
}

remove(outDir)
  .then(() => mkdirp(statsDir))
  .then(() => globby([`${inDir}/**/index.scss`]))
  .then(files => {
    return loadConfig()
      .then(({plugins, options}) => {
        const processor = postcss(plugins)
        const bundles = {}

        const inPattern = new RegExp(`^${inDir}/`)
        const tasks = files.map(from => {
          const path = from.replace(inPattern, '')
          const name = bundleNames[path] || getPathName(dirname(path))

          const to = join(outDir, `${name}.css`)
          const meta = {
            name,
            source: from,
            sass: `@primer/css/${path}`,
            css: to,
            map: `${to}.map`,
            js: join(outDir, `${name}.js`),
            stats: join(statsDir, `${name}.json`),
            legacy: `primer-${name}/index.scss`
          }

          return readFile(from, encoding)
            .then(scss => {
              meta.imports = getExternalImports(scss, path).map(getPathName)
              return processor.process(scss, Object.assign({from, to}, options))
            })
            .then(result =>
              Promise.all([
                writeFile(to, result.css, encoding),
                writeFile(meta.stats, JSON.stringify(cssstats(result.css)), encoding),
                writeFile(meta.js, `module.exports = {cssstats: require('./stats/${name}.json')}`, encoding),
                result.map ? writeFile(meta.map, result.map, encoding) : null
              ])
            )
            .then(() => (bundles[name] = meta))
        })

        return Promise.all(tasks).then(() => bundles)
      })
      .then(bundles => {
        const meta = {bundles}
        return writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2), encoding)
      })
      .then(writeVariableData)
      .then(writeDeprecationData)
  })
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })

function getExternalImports(scss, relativeTo) {
  const imports = []
  const dir = dirname(relativeTo)
  // XXX: this might *seem* fragile, but since we enforce double quotes via
  // stylelint, I think it's kosher.
  scss.replace(/@import "(.+)\/index\.scss";/g, (_, dep) => {
    imports.push(join(dir, dep))
  })
  return imports
}

function getPathName(path) {
  return path.replace(/\//g, '-')
}

function writeDeprecationData() {
  const {versionDeprecations, selectorDeprecations} = require('../deprecations')
  const data = {
    versions: versionDeprecations,
    selectors: Array.from(selectorDeprecations.entries()).reduce((obj, [selector, deprecation]) => {
      obj[selector] = deprecation
      return obj
    }, {})
  }
  return writeFile(join(outDir, 'deprecations.json'), JSON.stringify(data, null, 2))
}

function writeVariableData() {
  const analyzeVariables = require('./analyze-variables')
  return analyzeVariables('src/support/index.scss').then(data =>
    writeFile(join(outDir, 'variables.json'), JSON.stringify(data, null, 2))
  )
}
