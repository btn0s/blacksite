export default {
  meta: { name: 'game' },
  rules: {
    'no-comments': {
      create(context) {
        return { Program() { for (const comment of context.sourceCode.getAllComments()) context.report({ node: comment, message: 'Comments are not allowed.' }) } }
      },
    },
    'no-tests': {
      create(context) {
        return { Program(node) { if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(context.filename)) context.report({ node, message: 'Test files are not allowed.' }) } }
      },
    },
  },
}
