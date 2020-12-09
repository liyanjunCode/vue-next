import { CompilerOptions } from './options'
import { baseParse } from './parse'
import { transform, NodeTransform, DirectiveTransform } from './transform'
import { generate, CodegenResult } from './codegen'
import { RootNode } from './ast'
import { isString, extend } from '@vue/shared'
import { transformIf } from './transforms/vIf'
import { transformFor } from './transforms/vFor'
import { transformExpression } from './transforms/transformExpression'
import { transformSlotOutlet } from './transforms/transformSlotOutlet'
import { transformElement } from './transforms/transformElement'
import { transformOn } from './transforms/vOn'
import { transformBind } from './transforms/vBind'
import { trackSlotScopes, trackVForSlotScopes } from './transforms/vSlot'
import { transformText } from './transforms/transformText'
import { transformOnce } from './transforms/vOnce'
import { transformModel } from './transforms/vModel'
import { defaultOnError, createCompilerError, ErrorCodes } from './errors'

export type TransformPreset = [
  NodeTransform[],
  Record<string, DirectiveTransform>
]

export function getBaseTransformPreset(
  prefixIdentifiers?: boolean
): TransformPreset {
  return [
    [
      transformOnce,
      transformIf,
      transformFor,
      //只有在 Node.js 环境下的编译或者是 Web 端的非生产环境下才会执行 transformExpression
      ...(!__BROWSER__ && prefixIdentifiers
        ? [
          // order is important
          trackVForSlotScopes,
          transformExpression
        ]
        : __BROWSER__ && __DEV__
          ? [transformExpression]
          : []),
      transformSlotOutlet,
      transformElement,  //元素节点转换函数实现
      trackSlotScopes,
      transformText
    ],
    {
      on: transformOn,
      bind: transformBind,
      model: transformModel
    }
  ]
}

// we name it `baseCompile` so that higher order compilers like
// @vue/compiler-dom can export `compile` while re-exporting everything else.
export function baseCompile(
  template: string | RootNode,
  options: CompilerOptions = {}
): CodegenResult {
  const onError = options.onError || defaultOnError
  const isModuleMode = options.mode === 'module'
  /* istanbul ignore if */
  if (__BROWSER__) {
    if (options.prefixIdentifiers === true) {
      onError(createCompilerError(ErrorCodes.X_PREFIX_ID_NOT_SUPPORTED))
    } else if (isModuleMode) {
      onError(createCompilerError(ErrorCodes.X_MODULE_MODE_NOT_SUPPORTED))
    }
  }

  const prefixIdentifiers =
    !__BROWSER__ && (options.prefixIdentifiers === true || isModuleMode)
  if (!prefixIdentifiers && options.cacheHandlers) {
    onError(createCompilerError(ErrorCodes.X_CACHE_HANDLER_NOT_SUPPORTED))
  }
  if (options.scopeId && !isModuleMode) {
    onError(createCompilerError(ErrorCodes.X_SCOPE_ID_NOT_SUPPORTED))
  }
  //baseParse 解析模板， 生成抽象ast树
  const ast = isString(template) ? baseParse(template, options) : template
  // 获取节点和指令转换的方法
  const [nodeTransforms, directiveTransforms] = getBaseTransformPreset(
    prefixIdentifiers
  )
  // AST 转换 
  transform(
    ast,
    extend({}, options, {
      prefixIdentifiers,
      nodeTransforms: [
        ...nodeTransforms,
        ...(options.nodeTransforms || []) // user transforms
      ],
      directiveTransforms: extend(
        {},
        directiveTransforms,
        options.directiveTransforms || {} // user transforms
      )
    })
  )
  // 生成代码 
  return generate(
    ast,
    extend({}, options, {
      prefixIdentifiers
    })
  )
}
