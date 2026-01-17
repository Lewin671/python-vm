import type { VirtualMachine } from './vm';
import { ASTNode, ASTNodeType } from '../types';
import { PyValue, Scope } from './runtime-types';

export function* evaluateExpressionGenerator(this: VirtualMachine, node: ASTNode, scope: Scope): Generator<PyValue, PyValue> {
  switch (node.type) {
    case ASTNodeType.YIELD: {
      const value = node.value ? yield* this.evaluateExpressionGenerator(node.value as ASTNode, scope) : null;
      const sent = yield value;
      return sent;
    }
    case ASTNodeType.BINARY_OPERATION: {
      const left = yield* this.evaluateExpressionGenerator(node.left as ASTNode, scope);
      const right = yield* this.evaluateExpressionGenerator(node.right as ASTNode, scope);
      return this.applyBinary(node.operator!, left, right);
    }
    case ASTNodeType.UNARY_OPERATION: {
      const operand = yield* this.evaluateExpressionGenerator(node.operand as ASTNode, scope);
      return this.evaluateExpression({ ...node, operand } as ASTNode, scope);
    }
    case ASTNodeType.COMPARE: {
      const left = yield* this.evaluateExpressionGenerator(node.left as ASTNode, scope);
      const comparators = [];
      for (const comp of node.comparators!) {
        comparators.push(yield* this.evaluateExpressionGenerator(comp as ASTNode, scope));
      }
      return this.evaluateExpression({ ...node, left, comparators } as ASTNode, scope);
    }
    case ASTNodeType.CALL: {
      const callee = yield* this.evaluateExpressionGenerator(node.callee!, scope);
      const positional: PyValue[] = [];
      const kwargs: Record<string, PyValue> = {};
      for (const arg of node.args!) {
        if (arg.type === 'KeywordArg') {
          kwargs[arg.name] = yield* this.evaluateExpressionGenerator(arg.value, scope);
        } else if (arg.type === 'StarArg') {
          const value = yield* this.evaluateExpressionGenerator(arg.value as ASTNode, scope);
          positional.push(...(Array.isArray(value) ? value : Array.from(value as PyValue)));
        } else if (arg.type === 'KwArg') {
          const value = yield* this.evaluateExpressionGenerator(arg.value as ASTNode, scope);
          Object.assign(kwargs, value as PyValue);
        } else {
          positional.push(yield* this.evaluateExpressionGenerator(arg as ASTNode, scope));
        }
      }
      return this.callFunction(callee, positional, scope, kwargs);
    }
    case ASTNodeType.ATTRIBUTE: {
      const obj = yield* this.evaluateExpressionGenerator(node.object as ASTNode, scope);
      return this.getAttribute(obj, node.name!, scope);
    }
    case ASTNodeType.SUBSCRIPT: {
      const obj = yield* this.evaluateExpressionGenerator(node.object as ASTNode, scope);
      const index = yield* this.evaluateExpressionGenerator(node.index as ASTNode, scope);
      return this.getSubscript(obj, index);
    }
    case ASTNodeType.IF_EXPRESSION: {
      const test = yield* this.evaluateExpressionGenerator(node.test as ASTNode, scope);
      return this.isTruthy(test, scope)
        ? yield* this.evaluateExpressionGenerator(node.consequent as ASTNode, scope)
        : yield* this.evaluateExpressionGenerator(node.alternate as ASTNode, scope);
    }
    default:
      return this.evaluateExpression(node, scope);
  }
}
