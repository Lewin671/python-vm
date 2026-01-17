import type { VirtualMachine } from './vm';
import { ASTNodeType } from '../types';
import { PyValue } from './runtime-types';

export function* evaluateExpressionGenerator(this: VirtualMachine, node: PyValue, scope: PyValue): Generator<PyValue, PyValue> {
  switch (node.type) {
    case ASTNodeType.YIELD: {
      const value = node.value ? yield* this.evaluateExpressionGenerator(node.value, scope) : null;
      const sent = yield value;
      return sent;
    }
    case ASTNodeType.BINARY_OPERATION: {
      const left = yield* this.evaluateExpressionGenerator(node.left, scope);
      const right = yield* this.evaluateExpressionGenerator(node.right, scope);
      return this.applyBinary(node.operator, left, right);
    }
    case ASTNodeType.UNARY_OPERATION: {
      const operand = yield* this.evaluateExpressionGenerator(node.operand, scope);
      return this.evaluateExpression({ ...node, operand }, scope);
    }
    case ASTNodeType.COMPARE: {
      const left = yield* this.evaluateExpressionGenerator(node.left, scope);
      const comparators = [];
      for (const comp of node.comparators) {
        comparators.push(yield* this.evaluateExpressionGenerator(comp, scope));
      }
      return this.evaluateExpression({ ...node, left, comparators }, scope);
    }
    case ASTNodeType.CALL: {
      const callee = yield* this.evaluateExpressionGenerator(node.callee, scope);
      const positional: PyValue[] = [];
      const kwargs: Record<string, PyValue> = {};
      for (const arg of node.args) {
        if (arg.type === 'KeywordArg') {
          kwargs[arg.name] = yield* this.evaluateExpressionGenerator(arg.value, scope);
        } else if (arg.type === 'StarArg') {
          const value = yield* this.evaluateExpressionGenerator(arg.value, scope);
          positional.push(...(Array.isArray(value) ? value : Array.from(value)));
        } else if (arg.type === 'KwArg') {
          const value = yield* this.evaluateExpressionGenerator(arg.value, scope);
          Object.assign(kwargs, value);
        } else {
          positional.push(yield* this.evaluateExpressionGenerator(arg, scope));
        }
      }
      return this.callFunction(callee, positional, scope, kwargs);
    }
    case ASTNodeType.ATTRIBUTE: {
      const obj = yield* this.evaluateExpressionGenerator(node.object, scope);
      return this.getAttribute(obj, node.name, scope);
    }
    case ASTNodeType.SUBSCRIPT: {
      const obj = yield* this.evaluateExpressionGenerator(node.object, scope);
      const index = yield* this.evaluateExpressionGenerator(node.index, scope);
      return this.getSubscript(obj, index);
    }
    case ASTNodeType.IF_EXPRESSION: {
      const test = yield* this.evaluateExpressionGenerator(node.test, scope);
      return this.isTruthy(test, scope)
        ? yield* this.evaluateExpressionGenerator(node.consequent, scope)
        : yield* this.evaluateExpressionGenerator(node.alternate, scope);
    }
    default:
      return this.evaluateExpression(node, scope);
  }
}
