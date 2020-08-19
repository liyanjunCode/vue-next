// This entry is the "full-build" that includes both the runtime
// and the compiler, and supports on-the-fly compilation of the template option.
import { initDev } from './dev'
import { compile, CompilerOptions, CompilerError } from '@vue/compiler-dom'
import { registerRuntimeCompiler, RenderFunction, warn } from '@vue/runtime-dom'
import * as runtimeDom from '@vue/runtime-dom'
import { isString, NOOP, generateCodeFrame, extend } from '@vue/shared'
import { InternalRenderFunction } from 'packages/runtime-core/src/component'

__DEV__ && initDev()

const compileCache: Record<string, RenderFunction> = Object.create(null)
// 模板编译的过程
function compileToFunction(
  template: string | HTMLElement,
  options?: CompilerOptions
): RenderFunction {
  // 如果template是真实的dom节点， 就从真的dom节点获取用户写的dom字符串
  if (!isString(template)) {
    if (template.nodeType) {
      template = template.innerHTML
    } else {
      __DEV__ && warn(`invalid template option: `, template)
      return NOOP
    }
  }
  // 缓存， 如果已经编译过有了缓存， 不在进行编译
  const key = template
  const cached = compileCache[key]
  if (cached) {
    return cached
  }
  // 第一个是#号， 说明写的是id选择器可能写的是template或是script标签
  if (template[0] === '#') {
    const el = document.querySelector(template)
    if (__DEV__ && !el) {
      warn(`Template element not found or is empty: ${template}`)
    }
    // __UNSAFE__
    // Reason: potential execution of JS expressions in in-DOM template.
    // The user must make sure the in-DOM template is trusted. If it's rendered
    // by the server, the template should not contain any user data.
    // 拿到写的dom模板
    template = el ? el.innerHTML : ``
  }
  // compile模板编译方法来自@vue/compiler-dom,传入模板template和第二个参数（处理字符串时的一些钩子函数）extend适用于对象合并
  // 编译成字符串形式的
  const { code } = compile(
    template,
    extend(
      {
        hoistStatic: true,
        // 如果是开发环境， 在控制台输出详情， 生产环境， 直接抛错
        onError(err: CompilerError) {
          if (__DEV__) {
            const message = `Template compilation error: ${err.message}`
            const codeFrame =
              err.loc &&
              generateCodeFrame(
                template as string,
                err.loc.start.offset,
                err.loc.end.offset
              )
            warn(codeFrame ? `${message}\n${codeFrame}` : message)
          } else {
            /* istanbul ignore next */
            throw err
          }
        }
      },
      options
    )
  )

  // The wildcard import results in a huge object with every export
  // with keys that cannot be mangled, and can be quite heavy size-wise.
  // In the global build we know `Vue` is available globally so we can avoid
  // the wildcard object.
  // 生成渲染函数
  const render = (__GLOBAL__
    ? new Function(code)()
    : new Function('Vue', code)(runtimeDom)) as RenderFunction

    // mark the function as runtime compiled
    ; (render as InternalRenderFunction)._rc = true

  return (compileCache[key] = render)
}
// 将编译函数注册到了runtime-core的component文件中使用
registerRuntimeCompiler(compileToFunction)

export { compileToFunction as compile }
// 从这导出的runtime-dom中的所有方法， 包括createApp， createSSRApp， 这相当于入口
export * from '@vue/runtime-dom'
