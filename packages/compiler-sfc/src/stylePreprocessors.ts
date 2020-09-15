import merge from 'merge-source-map'
import { RawSourceMap } from 'source-map'
import { SFCStyleCompileOptions } from './compileStyle'

export type StylePreprocessor = (
  source: string,
  map: RawSourceMap | undefined,
  options: {
    [key: string]: any
    filename: string
  },
  customRequire: SFCStyleCompileOptions['preprocessCustomRequire']
) => StylePreprocessorResults

export interface StylePreprocessorResults {
  code: string
  map?: object
  errors: Error[]
  dependencies: string[]
}

// .scss/.sass processor
const scss: StylePreprocessor = (source, map, options, load = require) => {
  const nodeSass = load('sass')
  const finalOptions = {
    ...options,
    data: (options.additionalData || '') + source,
    file: options.filename,
    outFile: options.filename,
    sourceMap: !!map
  }

  try {
    const result = nodeSass.renderSync(finalOptions)
    const dependencies = result.stats.includedFiles
    if (map) {
      return {
        code: result.css.toString(),
        map: merge(map, JSON.parse(result.map.toString())),
        errors: [],
        dependencies
      }
    }

    return { code: result.css.toString(), errors: [], dependencies }
  } catch (e) {
    return { code: '', errors: [e], dependencies: [] }
  }
}

const sass: StylePreprocessor = (source, map, options, load) =>
  scss(
    source,
    map,
    {
      ...options,
      indentedSyntax: true
    },
    load
  )

// .less
const less: StylePreprocessor = (source, map, options, load = require) => {
  const nodeLess = load('less')

  let result: any
  let error: Error | null = null
  nodeLess.render(
    source,
    { ...options, syncImport: true },
    (err: Error | null, output: any) => {
      error = err
      result = output
    }
  )

  if (error) return { code: '', errors: [error], dependencies: [] }
  const dependencies = result.imports
  if (map) {
    return {
      code: result.css.toString(),
      map: merge(map, result.map),
      errors: [],
      dependencies: dependencies
    }
  }

  return {
    code: result.css.toString(),
    errors: [],
    dependencies: dependencies
  }
}

// .styl
const styl: StylePreprocessor = (source, map, options, load = require) => {
  const nodeStylus = load('stylus')
  try {
    const ref = nodeStylus(source)
    Object.keys(options).forEach(key => ref.set(key, options[key]))
    if (map) ref.set('sourcemap', { inline: false, comment: false })

    const result = ref.render()
    const dependencies = ref.deps()
    if (map) {
      return {
        code: result,
        map: merge(map, ref.sourcemap),
        errors: [],
        dependencies
      }
    }

    return { code: result, errors: [], dependencies }
  } catch (e) {
    return { code: '', errors: [e], dependencies: [] }
  }
}

export type PreprocessLang = 'less' | 'sass' | 'scss' | 'styl' | 'stylus'

export const processors: Record<PreprocessLang, StylePreprocessor> = {
  less,
  sass,
  scss,
  styl,
  stylus: styl
}
