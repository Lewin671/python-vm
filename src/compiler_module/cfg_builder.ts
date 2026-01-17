import { ASTNode, ASTNodeType, OpCode, Instruction, CompareOp, BasicBlock, CFG, ByteCode } from '../types';
import { Linearizer } from './linearizer';
import { parseStringToken } from '../common/string-token';

export class CFGBuilder {
    private blocks: BasicBlock[] = [];
    private currentBlock: BasicBlock;
    private blockIdCounter = 0;

    private constants: any[] = [];
    private names: string[] = [];
    private varnames: string[] = [];
    private argcount: number = 0;
    private globalVars: Set<string> = new Set();  // Track global variable declarations
    private nonlocalVars: Set<string> = new Set();  // Track nonlocal variable declarations
    private withStack: number = 0; // Track nested with statements for cleanup (not strictly used by linearizer but good for debugging)

    // Loop context stack for break/continue
    private loopStack: Array<{
        breakTarget: BasicBlock;
        continueTarget: BasicBlock;
        loopType: 'for' | 'while';  // Track loop type for break/continue handling
    }> = [];

    constructor(argcount: number = 0, initialVarnames: string[] = []) {
        this.argcount = argcount;
        this.varnames = [...initialVarnames];
        this.currentBlock = this.createBlock();
    }

    private createBlock(): BasicBlock {
        const block: BasicBlock = {
            id: this.blockIdCounter++,
            instructions: [],
        };
        this.blocks.push(block);
        return block;
    }

    private addInstruction(opcode: OpCode, arg?: number) {
        this.currentBlock.instructions.push({ opcode, arg });
    }

    private getConstantIndex(value: any): number {
        const index = this.constants.findIndex(c => c === value);
        if (index !== -1) return index;
        this.constants.push(value);
        return this.constants.length - 1;
    }

    private getNameIndex(name: string): number {
        let index = this.names.indexOf(name);
        if (index !== -1) return index;
        this.names.push(name);
        return this.names.length - 1;
    }

    private getVarIndex(name: string): number {
        let index = this.varnames.indexOf(name);
        if (index !== -1) return index;
        this.varnames.push(name);
        return this.varnames.length - 1;
    }

    build(ast: ASTNode): CFG {
        const entry = this.currentBlock;
        this.visit(ast);
        if (this.currentBlock.instructions.length === 0 || this.currentBlock.instructions[this.currentBlock.instructions.length - 1].opcode !== OpCode.RETURN_VALUE) {
            this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
            this.addInstruction(OpCode.RETURN_VALUE);
        }
        return { entry, blocks: this.blocks };
    }

    getConstants() { return this.constants; }
    getNames() { return this.names; }
    getVarnames() { return this.varnames; }
    getArgcount() { return this.argcount; }
    getGlobals() { return Array.from(this.globalVars); }
    getNonlocals() { return Array.from(this.nonlocalVars); }

    private visit(node: any) {
        if (!node) return;

        switch (node.type) {
            case ASTNodeType.PROGRAM:
                for (const stmt of node.body) {
                    this.visit(stmt);
                }
                break;

            case ASTNodeType.EXPRESSION_STATEMENT:
                this.visit(node.expression);
                this.addInstruction(OpCode.POP_TOP);
                break;

            case ASTNodeType.ASSIGNMENT:
                this.visit(node.value);
                for (let i = 0; i < node.targets.length; i++) {
                    if (i < node.targets.length - 1) {
                        this.addInstruction(OpCode.DUP_TOP);
                    }
                    this.visitTarget(node.targets[i], 'store');
                }
                break;

            case ASTNodeType.AUG_ASSIGNMENT:
                // Handle augmented assignment (+=, -=, etc.)
                // For subscripts and attributes, we need to avoid re-evaluating the target
                if (node.target.type === ASTNodeType.SUBSCRIPT) {
                    // For x[i] += value:
                    // 1. Load x, load i (evaluate both once)
                    // 2. DUP_TOP_TWO to duplicate x and i
                    // 3. LOAD_SUBSCR to get x[i]
                    // 4. Load value
                    // 5. Inplace operation
                    // 6. ROT_THREE to bring x and i to top
                    // 7. STORE_SUBSCR
                    this.visit(node.target.object || node.target.value);
                    this.visit(node.target.index || node.target.slice);
                    this.addInstruction(OpCode.DUP_TOP_TWO);
                    this.addInstruction(OpCode.LOAD_SUBSCR);
                    this.visit(node.value);
                    this.addInplaceOperation(node.operator.slice(0, -1));
                    this.addInstruction(OpCode.ROT_THREE);
                    this.addInstruction(OpCode.STORE_SUBSCR);
                } else if (node.target.type === ASTNodeType.ATTRIBUTE) {
                    // For x.attr += value:
                    // 1. Load x (evaluate once)               -> [x]
                    // 2. DUP_TOP to duplicate x               -> [x, x]
                    // 3. LOAD_ATTR to get x.attr              -> [x, attr_val]
                    // 4. Load value                           -> [x, attr_val, value]
                    // 5. Inplace operation                    -> [x, new_val]
                    // 6. STORE_ATTR (pops new_val, then x)
                    this.visit(node.target.object || node.target.value);
                    this.addInstruction(OpCode.DUP_TOP);
                    this.addInstruction(OpCode.LOAD_ATTR, this.getNameIndex(node.target.name || node.target.attr));
                    this.visit(node.value);
                    this.addInplaceOperation(node.operator.slice(0, -1));
                    this.addInstruction(OpCode.STORE_ATTR, this.getNameIndex(node.target.name || node.target.attr));
                } else {
                    // For simple names: load, operate in-place, store
                    this.visit(node.target);
                    this.visit(node.value);
                    this.addInplaceOperation(node.operator.slice(0, -1));
                    this.visitTarget(node.target, 'store');
                }
                break;

            case ASTNodeType.NUMBER_LITERAL: {
                const raw = node.value;
                if (typeof raw === 'string') {
                    const text = raw.replace(/_/g, '');
                    const lower = text.toLowerCase();
                    if (lower.endsWith('j')) {
                        const imagText = lower.slice(0, -1);
                        const imag = imagText === '' || imagText === '+' ? 1 : imagText === '-' ? -1 : parseFloat(imagText);
                        const val = { __complex__: true, re: 0, im: imag };
                        this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(val));
                        break;
                    }
                    if (/[.eE]/.test(text)) {
                        const val = new Number(parseFloat(text));
                        this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(val));
                        break;
                    }
                    const val = BigInt(text);
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(val));
                    break;
                }

                const val = (typeof raw === 'number' && !Number.isInteger(raw)) ? new Number(raw) : BigInt(raw);
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(val));
                break;
            }
            case ASTNodeType.STRING_LITERAL: {
                const { value, isFString } = parseStringToken(node.value);
                const val = isFString ? { __fstring__: value } : value;
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(val));
                break;
            }
            case ASTNodeType.BOOLEAN_LITERAL:
            case ASTNodeType.NONE_LITERAL:
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(node.value));
                break;

            case ASTNodeType.IDENTIFIER:
                // Check if variable is declared global
                if (this.globalVars.has(node.name)) {
                    this.addInstruction(OpCode.LOAD_GLOBAL, this.getNameIndex(node.name));
                } else if (this.nonlocalVars.has(node.name)) {
                    // nonlocal variables use LOAD_NAME to search enclosing scopes
                    this.addInstruction(OpCode.LOAD_NAME, this.getNameIndex(node.name));
                } else if (this.varnames.includes(node.name)) {
                    this.addInstruction(OpCode.LOAD_FAST, this.getVarIndex(node.name));
                } else {
                    this.addInstruction(OpCode.LOAD_NAME, this.getNameIndex(node.name));
                }
                break;

            case 'StarArg':
            case 'KwArg':
                this.visit(node.value);
                break;

            case ASTNodeType.BINARY_OPERATION:
                this.visit(node.left);
                this.visit(node.right);
                this.addBinaryOperation(node.operator);
                break;

            case ASTNodeType.UNARY_OPERATION:
                this.visit(node.operand);
                this.addUnaryOperation(node.operator);
                break;

            case ASTNodeType.BOOL_OPERATION:
                this.visitBoolOp(node);
                break;

            case ASTNodeType.IF_EXPRESSION:
                this.visitIfExpression(node);
                break;

            case ASTNodeType.COMPARE:
                const operators = node.ops || node.operators || [];
                if (operators.length === 0) {
                    this.visit(node.left);
                } else if (operators.length === 1) {
                    // Simple comparison: a < b
                    this.visit(node.left);
                    this.visit(node.comparators[0]);
                    this.addCompareOperation(operators[0]);
                } else {
                    // Chained comparison: a < b < c
                    // Compile with short-circuit evaluation
                    const endBlock = this.createBlock();
                    const cleanupBlock = this.createBlock();

                    this.visit(node.left);
                    for (let i = 0; i < operators.length; i++) {
                        this.visit(node.comparators[i]);
                        if (i < operators.length - 1) {
                            // Not the last: duplicate and rotate for next comparison
                            this.addInstruction(OpCode.DUP_TOP);
                            this.addInstruction(OpCode.ROT_THREE);
                        }
                        this.addCompareOperation(operators[i]);

                        if (i < operators.length - 1) {
                            // Short-circuit: if false, jump to cleanup with extra value on stack
                            const nextBlock = this.createBlock();
                            this.currentBlock.jumpCondition = 'if_false_or_pop';
                            this.currentBlock.jumpTarget = cleanupBlock;
                            this.currentBlock.next = nextBlock;
                            this.currentBlock = nextBlock;
                        }
                    }

                    // All comparisons succeeded, fall through to end
                    this.currentBlock.next = endBlock;

                    // Cleanup block: remove duplicate value from stack after failed comparison
                    this.currentBlock = cleanupBlock;
                    this.addInstruction(OpCode.ROT_TWO);
                    this.addInstruction(OpCode.POP_TOP);
                    this.currentBlock.next = endBlock;

                    // End block: result is on stack
                    this.currentBlock = endBlock;
                }
                break;

            case ASTNodeType.CALL:
                this.visit(node.callee || node.func);
                {
                    const rawArgs = (node.args || []) as any[];
                    const hasStar = rawArgs.some(a => a && a.type === 'StarArg');
                    const hasKw = rawArgs.some(a => a && a.type === 'KwArg');

                    if (hasStar || hasKw) {
                        // Simplified CALL_FUNCTION_EX: assumes [pos_args_tuple, kw_args_dict]
                        // find the *args
                        const starArg = rawArgs.find(a => a && a.type === 'StarArg');
                        if (starArg) {
                            this.visit(starArg.value);
                        } else {
                            this.addInstruction(OpCode.BUILD_TUPLE, 0);
                        }

                        const kwArg = rawArgs.find(a => a && a.type === 'KwArg');
                        if (kwArg) {
                            this.visit(kwArg.value);
                            this.addInstruction(OpCode.CALL_FUNCTION_EX, 1);
                        } else {
                            this.addInstruction(OpCode.CALL_FUNCTION_EX, 0);
                        }
                    } else {
                        const positional: any[] = [];
                        const keyword: Array<{ type: 'KeywordArg'; name: string; value: any }> = [];

                        for (const a of rawArgs) {
                            if (a && a.type === 'KeywordArg') {
                                keyword.push(a);
                            } else {
                                positional.push(a);
                            }
                        }

                        for (const a of positional) {
                            this.visit(a);
                        }
                        for (const k of keyword) {
                            this.visit(k.value);
                        }

                        if (keyword.length > 0) {
                            for (const k of keyword) {
                                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(k.name));
                            }
                            this.addInstruction(OpCode.BUILD_TUPLE, keyword.length);
                            this.addInstruction(OpCode.CALL_FUNCTION_KW, positional.length + keyword.length);
                        } else {
                            this.addInstruction(OpCode.CALL_FUNCTION, positional.length);
                        }
                    }
                }
                break;

            case ASTNodeType.IF_STATEMENT:
                this.visitIf(node);
                break;

            case ASTNodeType.WHILE_STATEMENT:
                this.visitWhile(node);
                break;

            case ASTNodeType.FOR_STATEMENT:
                this.visitFor(node);
                break;

            case ASTNodeType.FUNCTION_DEF:
                this.visitFunctionDef(node);
                break;

            case ASTNodeType.CLASS_DEF: {
                const bases = (node.bases || []) as any[];
                const subBuilder = new CFGBuilder(0, []);
                const subCfg = subBuilder.build({ type: ASTNodeType.PROGRAM, body: node.body || [] });
                const linearizer = new Linearizer();
                const subBytecode = linearizer.linearize(
                    subCfg,
                    subBuilder.getConstants(),
                    subBuilder.getNames(),
                    subBuilder.getVarnames(),
                    0,
                    [],
                    subBuilder.getGlobals(),
                    subBuilder.getNonlocals()
                );
                subBytecode.name = `<classbody ${node.name}>`;

                // build_class(class_body_fn, name, *bases)
                this.addInstruction(OpCode.LOAD_BUILD_CLASS);
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(subBytecode));
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(subBytecode.name));
                this.addInstruction(OpCode.MAKE_FUNCTION, 0);
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(node.name));
                for (const base of bases) {
                    this.visit(base);
                }
                this.addInstruction(OpCode.CALL_FUNCTION, 2 + bases.length);
                this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(node.name));
                break;
            }

            case ASTNodeType.LAMBDA:
                this.visitLambda(node);
                break;

            case ASTNodeType.RETURN_STATEMENT:
                if (node.value) {
                    this.visit(node.value);
                } else {
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
                }
                this.addInstruction(OpCode.RETURN_VALUE);
                break;

            case ASTNodeType.YIELD:
                if (node.value) {
                    this.visit(node.value);
                } else {
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
                }
                this.addInstruction(OpCode.YIELD_VALUE);
                break;

            case ASTNodeType.ATTRIBUTE:
                this.visit(node.object || node.value);
                this.addInstruction(OpCode.LOAD_ATTR, this.getNameIndex(node.name || node.attr));
                break;

            case ASTNodeType.SUBSCRIPT:
                this.visit(node.object || node.value);
                this.visit(node.index || node.slice);
                this.addInstruction(OpCode.LOAD_SUBSCR);
                break;

            case ASTNodeType.LIST_LITERAL:
                for (const el of node.elements) this.visit(el);
                this.addInstruction(OpCode.BUILD_LIST, node.elements.length);
                break;

            case ASTNodeType.LIST_COMP:
            case ASTNodeType.DICT_COMP:
            case ASTNodeType.SET_COMP:
            case ASTNodeType.GENERATOR_EXPR:
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(node));
                this.addInstruction(OpCode.EVAL_AST);
                break;

            case ASTNodeType.TUPLE_LITERAL:
                for (const el of node.elements) this.visit(el);
                this.addInstruction(OpCode.BUILD_TUPLE, node.elements.length);
                break;

            case ASTNodeType.DICT_LITERAL: {
                const entries = node.entries || [];
                for (const entry of entries) {
                    this.visit(entry.key);
                    this.visit(entry.value);
                }
                this.addInstruction(OpCode.BUILD_MAP, entries.length);
                break;
            }

            case ASTNodeType.SET_LITERAL:
                for (const el of node.elements) this.visit(el);
                this.addInstruction(OpCode.BUILD_SET, node.elements.length);
                break;

            case ASTNodeType.SLICE:
                // Handle slice: start:end:step
                // Be careful: 0 is falsy but valid, so check for null/undefined explicitly
                if (node.start !== null && node.start !== undefined) {
                    this.visit(node.start);
                } else {
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
                }
                if (node.end !== null && node.end !== undefined) {
                    this.visit(node.end);
                } else {
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
                }
                if (node.step !== null && node.step !== undefined) {
                    this.visit(node.step);
                    this.addInstruction(OpCode.BUILD_SLICE, 3);
                } else {
                    this.addInstruction(OpCode.BUILD_SLICE, 2);
                }
                break;
                break;

            case ASTNodeType.ASSERT_STATEMENT: {
                this.visit(node.test);
                const skipBlock = this.createBlock();
                this.currentBlock.jumpCondition = 'if_true';
                this.currentBlock.jumpTarget = skipBlock;

                const failBlock = this.createBlock();
                this.currentBlock.next = failBlock;

                this.currentBlock = failBlock;
                this.addInstruction(OpCode.LOAD_NAME, this.getNameIndex('AssertionError'));
                const messageNode = node.message ?? node.msg;
                if (messageNode) {
                    this.visit(messageNode);
                    this.addInstruction(OpCode.CALL_FUNCTION, 1);
                } else {
                    this.addInstruction(OpCode.CALL_FUNCTION, 0);
                }
                this.addInstruction(OpCode.RAISE_VARARGS, 1);

                this.currentBlock = skipBlock;
                break;
            }

            case ASTNodeType.RAISE_STATEMENT: {
                if (node.exception) {
                    this.visit(node.exception);
                    this.addInstruction(OpCode.RAISE_VARARGS, 1);
                } else {
                    this.addInstruction(OpCode.RAISE_VARARGS, 0);
                }
                break;
            }

            case ASTNodeType.PASS_STATEMENT:
                break;

            case ASTNodeType.BREAK_STATEMENT:
                if (this.loopStack.length === 0) {
                    throw new Error('SyntaxError: break outside loop');
                }
                const loopContext = this.loopStack[this.loopStack.length - 1];
                // For FOR loops, we need to pop the iterator before jumping
                // (FOR_ITER pops it when exhausting, but break doesn't go through FOR_ITER)
                if (loopContext.loopType === 'for') {
                    this.addInstruction(OpCode.POP_TOP);  // Pop the iterator
                }
                this.currentBlock.next = loopContext.breakTarget;
                // Create a new unreachable block for any statements after break
                const unreachableAfterBreak = this.createBlock();
                unreachableAfterBreak.reachable = false;
                this.currentBlock = unreachableAfterBreak;
                break;

            case ASTNodeType.CONTINUE_STATEMENT:
                if (this.loopStack.length === 0) {
                    throw new Error('SyntaxError: continue not properly in loop');
                }
                const loopCtx = this.loopStack[this.loopStack.length - 1];
                this.currentBlock.next = loopCtx.continueTarget;
                // Create a new unreachable block for any statements after continue
                const unreachableAfterContinue = this.createBlock();
                unreachableAfterContinue.reachable = false;
                this.currentBlock = unreachableAfterContinue;
                break;

            case ASTNodeType.GLOBAL_STATEMENT:
                // Global declarations - mark variables as global
                for (const name of node.names || []) {
                    this.globalVars.add(name);
                }
                break;

            case ASTNodeType.NONLOCAL_STATEMENT:
                // Nonlocal declarations - mark variables as nonlocal
                for (const name of node.names || []) {
                    this.nonlocalVars.add(name);
                }
                break;

            case ASTNodeType.DELETE_STATEMENT:
                // Handle both 'target' (single) and 'targets' (array) for compatibility
                const deleteTargets = node.targets || (node.target ? [node.target] : []);
                for (const target of deleteTargets) {
                    this.visitTarget(target, 'delete');
                }
                break;

            case ASTNodeType.IMPORT_STATEMENT:
                for (const name of node.names) {
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(0));
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
                    this.addInstruction(OpCode.IMPORT_NAME, this.getNameIndex(name.name));
                    this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(name.asname || name.name));
                }
                break;

            case ASTNodeType.TRY_STATEMENT:
                this.visitTry(node);
                break;

            case ASTNodeType.WITH_STATEMENT:
                this.visitWith(node);
                break;

            case ASTNodeType.MATCH_STATEMENT:
                this.visitMatch(node);
                break;

            default:
                console.warn(`CFGBuilder: Unhandled node type ${node.type}`);
        }
    }

    private addBinaryOperation(operator: string) {
        switch (operator) {
            case '+': this.addInstruction(OpCode.BINARY_ADD); break;
            case '-': this.addInstruction(OpCode.BINARY_SUBTRACT); break;
            case '*': this.addInstruction(OpCode.BINARY_MULTIPLY); break;
            case '/': this.addInstruction(OpCode.BINARY_DIVIDE); break;
            case '//': this.addInstruction(OpCode.BINARY_FLOOR_DIVIDE); break;
            case '%': this.addInstruction(OpCode.BINARY_MODULO); break;
            case '**': this.addInstruction(OpCode.BINARY_POWER); break;
            case '<<': this.addInstruction(OpCode.BINARY_LSHIFT); break;
            case '>>': this.addInstruction(OpCode.BINARY_RSHIFT); break;
            case '&': this.addInstruction(OpCode.BINARY_AND); break;
            case '^': this.addInstruction(OpCode.BINARY_XOR); break;
            case '|': this.addInstruction(OpCode.BINARY_OR); break;
            default: throw new Error(`Unknown operator: ${operator}`);
        }
    }

    private addInplaceOperation(operator: string) {
        switch (operator) {
            case '+': this.addInstruction(OpCode.INPLACE_ADD); break;
            case '-': this.addInstruction(OpCode.INPLACE_SUBTRACT); break;
            case '*': this.addInstruction(OpCode.INPLACE_MULTIPLY); break;
            case '/': this.addInstruction(OpCode.INPLACE_DIVIDE); break;
            case '//': this.addInstruction(OpCode.INPLACE_FLOOR_DIVIDE); break;
            case '%': this.addInstruction(OpCode.INPLACE_MODULO); break;
            case '**': this.addInstruction(OpCode.INPLACE_POWER); break;
            case '<<': this.addInstruction(OpCode.INPLACE_LSHIFT); break;
            case '>>': this.addInstruction(OpCode.INPLACE_RSHIFT); break;
            case '&': this.addInstruction(OpCode.INPLACE_AND); break;
            case '^': this.addInstruction(OpCode.INPLACE_XOR); break;
            case '|': this.addInstruction(OpCode.INPLACE_OR); break;
            default: throw new Error(`Unknown operator: ${operator}`);
        }
    }

    private addCompareOperation(operator: string) {
        let op: CompareOp;
        switch (operator) {
            case '<': op = CompareOp.LT; break;
            case '<=': op = CompareOp.LE; break;
            case '==': op = CompareOp.EQ; break;
            case '!=': op = CompareOp.NE; break;
            case '>': op = CompareOp.GT; break;
            case '>=': op = CompareOp.GE; break;
            case 'in': op = CompareOp.IN; break;
            case 'not in': op = CompareOp.NOT_IN; break;
            case 'is': op = CompareOp.IS; break;
            case 'is not': op = CompareOp.IS_NOT; break;
            default: throw new Error(`Unknown compare operator: ${operator}`);
        }
        this.addInstruction(OpCode.COMPARE_OP, op);
    }

    private visitTarget(node: any, mode: 'store' | 'delete') {
        if (mode === 'store') {
            switch (node.type) {
                case ASTNodeType.IDENTIFIER:
                    // Check if variable is declared global
                    if (this.globalVars.has(node.name)) {
                        this.addInstruction(OpCode.STORE_GLOBAL, this.getNameIndex(node.name));
                    } else if (this.nonlocalVars.has(node.name)) {
                        // nonlocal variables use STORE_NAME to store in enclosing scopes
                        this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(node.name));
                    } else if (this.varnames.includes(node.name)) {
                        this.addInstruction(OpCode.STORE_FAST, this.getVarIndex(node.name));
                    } else {
                        this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(node.name));
                    }
                    break;
                case ASTNodeType.STARRED:
                    this.visitTarget(node.target, mode);
                    break;
                case ASTNodeType.ATTRIBUTE:
                    this.visit(node.object || node.value);
                    this.addInstruction(OpCode.ROT_TWO);
                    this.addInstruction(OpCode.STORE_ATTR, this.getNameIndex(node.name || node.attr));
                    break;
                case ASTNodeType.SUBSCRIPT:
                    this.visit(node.object || node.value);
                    this.visit(node.index || node.slice);
                    this.addInstruction(OpCode.STORE_SUBSCR);
                    break;
                case ASTNodeType.TUPLE_LITERAL:
                case ASTNodeType.LIST_LITERAL: {
                    const elements = node.elements || [];
                    const starIndex = elements.findIndex((el: any) => el && el.type === ASTNodeType.STARRED);
                    if (starIndex === -1) {
                        this.addInstruction(OpCode.UNPACK_SEQUENCE, elements.length);
                    } else {
                        const prefixCount = starIndex;
                        const suffixCount = elements.length - starIndex - 1;
                        // Pack prefix/suffix counts into a single arg like CPython: (prefix << 8) | suffix
                        this.addInstruction(OpCode.UNPACK_EX, (prefixCount << 8) | suffixCount);
                    }
                    for (const el of elements) {
                        this.visitTarget(el, mode);
                    }
                    break;
                }
                default:
                    throw new Error(`Unsupported assignment target: ${node.type}`);
            }
        } else if (mode === 'delete') {
            switch (node.type) {
                case ASTNodeType.IDENTIFIER:
                    if (this.globalVars.has(node.name)) {
                        this.addInstruction(OpCode.DELETE_GLOBAL, this.getNameIndex(node.name));
                    } else if (this.nonlocalVars.has(node.name)) {
                        this.addInstruction(OpCode.DELETE_NAME, this.getNameIndex(node.name));
                    } else if (this.varnames.includes(node.name)) {
                        this.addInstruction(OpCode.DELETE_FAST, this.getVarIndex(node.name));
                    } else {
                        this.addInstruction(OpCode.DELETE_NAME, this.getNameIndex(node.name));
                    }
                    break;
                case ASTNodeType.ATTRIBUTE:
                    this.visit(node.object || node.value);
                    this.addInstruction(OpCode.DELETE_ATTR, this.getNameIndex(node.name || node.attr));
                    break;
                case ASTNodeType.SUBSCRIPT:
                    this.visit(node.object || node.value);
                    this.visit(node.index || node.slice);
                    this.addInstruction(OpCode.DELETE_SUBSCR);
                    break;
                case ASTNodeType.TUPLE_LITERAL:
                case ASTNodeType.LIST_LITERAL:
                    for (const el of node.elements || []) {
                        this.visitTarget(el, mode);
                    }
                    break;
                default:
                    throw new Error(`Unsupported delete target: ${node.type}`);
            }
        }
    }

    private visitIf(node: any) {
        const thenBlock = this.createBlock();

        // Convert elifs to nested if statements in orelse
        let orelse = node.orelse || [];
        if (node.elifs && node.elifs.length > 0) {
            // Build nested if structure from elifs
            let currentElse = node.orelse || [];
            for (let i = node.elifs.length - 1; i >= 0; i--) {
                const elif = node.elifs[i];
                currentElse = [{
                    type: ASTNodeType.IF_STATEMENT,
                    test: elif.test,
                    body: elif.body,
                    orelse: currentElse,
                    elifs: []
                }];
            }
            orelse = currentElse;
        }

        const elseBlock = orelse && orelse.length > 0 ? this.createBlock() : null;
        const mergeBlock = this.createBlock();

        this.visit(node.test);
        this.currentBlock.jumpCondition = 'if_false';
        this.currentBlock.jumpTarget = elseBlock || mergeBlock;
        this.currentBlock.next = thenBlock;

        this.currentBlock = thenBlock;
        for (const stmt of node.body) {
            this.visit(stmt);
        }
        if (!this.currentBlock.next && !this.currentBlock.jumpTarget) {
            this.currentBlock.next = mergeBlock;
        }

        if (elseBlock) {
            this.currentBlock = elseBlock;
            for (const stmt of orelse) {
                this.visit(stmt);
            }
            if (!this.currentBlock.next && !this.currentBlock.jumpTarget) {
                this.currentBlock.next = mergeBlock;
            }
        }

        this.currentBlock = mergeBlock;
    }

    private visitWhile(node: any) {
        const loopBlock = this.createBlock();
        const bodyBlock = this.createBlock();
        const endBlock = this.createBlock();

        this.currentBlock.next = loopBlock;
        this.currentBlock = loopBlock;

        this.visit(node.test);
        this.currentBlock.jumpCondition = 'if_false';
        this.currentBlock.jumpTarget = endBlock;
        this.currentBlock.next = bodyBlock;

        this.currentBlock = bodyBlock;

        // Push loop context for break/continue
        this.loopStack.push({ breakTarget: endBlock, continueTarget: loopBlock, loopType: 'while' });

        for (const stmt of node.body) {
            this.visit(stmt);
        }

        // Pop loop context
        this.loopStack.pop();

        // Only add jump-back if current block is reachable and doesn't already have a transfer
        if (this.currentBlock.reachable !== false && !this.currentBlock.next && !this.currentBlock.jumpTarget) {
            if (process.env.DEBUG_CFG) {
                console.log(`WHILE: Adding jump-back from block ${this.currentBlock.id} to loop block ${loopBlock.id}`);
            }
            this.currentBlock.next = loopBlock;
        } else if (process.env.DEBUG_CFG) {
            console.log(`WHILE: NOT adding jump-back from block ${this.currentBlock.id}: reachable=${this.currentBlock.reachable}, hasNext=${!!this.currentBlock.next}, hasJumpTarget=${!!this.currentBlock.jumpTarget}`);
        }

        this.currentBlock = endBlock;
    }

    private visitFor(node: any) {
        this.visit(node.iter);
        this.addInstruction(OpCode.GET_ITER);

        const loopBlock = this.createBlock();
        const bodyBlock = this.createBlock();
        const endBlock = this.createBlock();

        this.currentBlock.next = loopBlock;
        this.currentBlock = loopBlock;

        // FOR_ITER controls loop termination by jumping to its arg when the iterator is exhausted.
        // We encode the target as a basic-block id here and let the linearizer patch it to an
        // instruction offset.
        this.addInstruction(OpCode.FOR_ITER, endBlock.id);
        // Ensure the end block is included in linearization even though it isn't a normal CFG edge.
        this.currentBlock.exceptionTarget = endBlock;
        this.currentBlock.next = bodyBlock;

        this.currentBlock = bodyBlock;

        // Push loop context for break/continue
        this.loopStack.push({ breakTarget: endBlock, continueTarget: loopBlock, loopType: 'for' });

        this.visitTarget(node.target, 'store');
        for (const stmt of node.body) {
            this.visit(stmt);
        }

        // Pop loop context
        this.loopStack.pop();

        // Only add jump-back if current block is reachable and doesn't already have a transfer
        if (this.currentBlock.reachable !== false && !this.currentBlock.next && !this.currentBlock.jumpTarget) {
            if (process.env.DEBUG_CFG) {
                console.log(`FOR: Adding jump-back from block ${this.currentBlock.id} to loop block ${loopBlock.id}`);
            }
            this.currentBlock.next = loopBlock;
        } else if (process.env.DEBUG_CFG) {
            console.log(`FOR: NOT adding jump-back from block ${this.currentBlock.id}: reachable=${this.currentBlock.reachable}, hasNext=${!!this.currentBlock.next}, hasJumpTarget=${!!this.currentBlock.jumpTarget}`);
        }

        this.currentBlock = endBlock;
    }

    private visitFunctionDef(node: any) {
        const isGenerator = this.containsYield(node.body || []);
        const parameterNames = node.params.map((p: any) => p.name);

        // Analyze function body to find all assigned variables (for local scope detection)
        const assignedVars = this.findAssignedVariables(node.body || []);
        const localVars = [...parameterNames, ...assignedVars];

        // Evaluate default arguments at function definition time
        const defaultsCount = node.params.filter((p: any) => p.defaultValue).length;
        for (const param of node.params) {
            if (param.defaultValue) {
                this.visit(param.defaultValue);
            }
        }

        // Process decorators (load them onto stack)
        const decorators = node.decorators || [];
        for (const decorator of decorators) {
            this.visit(decorator);
        }

        const subBuilder = new CFGBuilder(node.params.length, localVars);
        const subCfg = subBuilder.build({ type: ASTNodeType.PROGRAM, body: node.body });
        const linearizer = new Linearizer();
        const subBytecode = linearizer.linearize(
            subCfg,
            subBuilder.getConstants(),
            subBuilder.getNames(),
            subBuilder.getVarnames(),
            subBuilder.getArgcount(),
            node.params,
            subBuilder.getGlobals(),
            subBuilder.getNonlocals()
        );
        subBytecode.name = node.name;
        (subBytecode as any).isGenerator = isGenerator;
        if (isGenerator) {
            (subBytecode as any).astBody = node.body || [];
        }

        this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(subBytecode));
        this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(node.name));
        // Pass the number of defaults as arg to MAKE_FUNCTION
        this.addInstruction(OpCode.MAKE_FUNCTION, defaultsCount);

        // Apply decorators
        for (let i = 0; i < decorators.length; i++) {
            this.addInstruction(OpCode.CALL_FUNCTION, 1);
        }

        this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(node.name));
    }

    private containsYield(body: any[]): boolean {
        const visitAny = (n: any): boolean => {
            if (!n) return false;
            if (Array.isArray(n)) {
                return n.some(visitAny);
            }
            if (n.type === ASTNodeType.YIELD) return true;
            for (const v of Object.values(n)) {
                if (v && typeof v === 'object') {
                    if (visitAny(v)) return true;
                }
            }
            return false;
        };
        return visitAny(body);
    }

    private findAssignedVariables(body: any[]): string[] {
        const assigned = new Set<string>();
        const globals = new Set<string>();
        const nonlocals = new Set<string>();

        const visit = (n: any) => {
            if (!n) return;
            if (Array.isArray(n)) {
                n.forEach(visit);
                return;
            }

            switch (n.type) {
                case ASTNodeType.GLOBAL_STATEMENT:
                    if (n.names) {
                        n.names.forEach((name: string) => globals.add(name));
                    }
                    break;
                case ASTNodeType.NONLOCAL_STATEMENT:
                    if (n.names) {
                        n.names.forEach((name: string) => nonlocals.add(name));
                    }
                    break;
                case ASTNodeType.ASSIGNMENT:
                    if (n.targets) {
                        n.targets.forEach((t: any) => this.extractAssignedNames(t, assigned));
                    }
                    break;
                case ASTNodeType.AUG_ASSIGNMENT:
                    if (n.target) {
                        this.extractAssignedNames(n.target, assigned);
                    }
                    break;
                case ASTNodeType.FOR_STATEMENT:
                    if (n.target) {
                        if (Array.isArray(n.target)) {
                            n.target.forEach((t: any) => this.extractAssignedNames(t, assigned));
                        } else {
                            this.extractAssignedNames(n.target, assigned);
                        }
                    }
                    if (n.body) visit(n.body);
                    if (n.orelse) visit(n.orelse);
                    break;
                case ASTNodeType.FUNCTION_DEF:
                case ASTNodeType.CLASS_DEF:
                    // Don't recurse into nested functions/classes
                    break;
                default:
                    // Recurse into other node types
                    for (const v of Object.values(n)) {
                        if (v && typeof v === 'object') {
                            visit(v);
                        }
                    }
            }
        };
        visit(body);

        // Remove variables declared as global or nonlocal from the local variables list
        globals.forEach(name => assigned.delete(name));
        nonlocals.forEach(name => assigned.delete(name));

        return Array.from(assigned);
    }

    private extractAssignedNames(target: any, assigned: Set<string>) {
        if (!target) return;
        if (target.type === ASTNodeType.IDENTIFIER) {
            assigned.add(target.name);
        } else if (target.type === ASTNodeType.TUPLE_LITERAL || target.type === ASTNodeType.LIST_LITERAL) {
            if (target.elements) {
                target.elements.forEach((el: any) => this.extractAssignedNames(el, assigned));
            }
        } else if (target.type === ASTNodeType.STARRED) {
            this.extractAssignedNames(target.target, assigned);
        }
        // Don't extract from subscripts or attributes - those aren't local variable assignments
    }

    private visitLambda(node: any) {
        // Parser represents lambda params as strings (e.g. ['x'] or ['*args', '**kwargs']).
        // Normalize to the same param shape as FunctionDef so VM call binding works.
        const rawParams: any[] = Array.isArray(node.params) ? node.params : [];
        const params = rawParams.map((p: any) => {
            if (typeof p === 'string') {
                if (p.startsWith('**')) return { type: 'KwArg', name: p.slice(2) } as any;
                if (p.startsWith('*')) return { type: 'VarArg', name: p.slice(1) } as any;
                return { type: 'Param', name: p, defaultValue: null } as any;
            }
            return p;
        });
        const parameterNames = params.map((p: any) => p.name);
        const subBuilder = new CFGBuilder(params.length, parameterNames);
        const bodyBlock = { type: ASTNodeType.RETURN_STATEMENT, value: node.body };
        const subCfg = subBuilder.build({ type: ASTNodeType.PROGRAM, body: [bodyBlock] });
        const linearizer = new Linearizer();
        const subBytecode = linearizer.linearize(
            subCfg,
            subBuilder.getConstants(),
            subBuilder.getNames(),
            subBuilder.getVarnames(),
            subBuilder.getArgcount(),
            params,
            subBuilder.getGlobals(),
            subBuilder.getNonlocals()
        );
        subBytecode.name = '<lambda>';

        this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(subBytecode));
        this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex('<lambda>'));
        this.addInstruction(OpCode.MAKE_FUNCTION, 0);  // Lambdas have no defaults
    }

    private addUnaryOperation(operator: string) {
        switch (operator) {
            case '+': this.addInstruction(OpCode.UNARY_POSITIVE); break;
            case '-': this.addInstruction(OpCode.UNARY_NEGATIVE); break;
            case 'not': this.addInstruction(OpCode.UNARY_NOT); break;
            case '~': this.addInstruction(OpCode.UNARY_INVERT); break;
            default: throw new Error(`Unknown unary operator: ${operator}`);
        }
    }

    private visitBoolOp(node: any) {
        // Boolean operations with short-circuit evaluation
        // For 'and': if first is false, skip rest
        // For 'or': if first is true, skip rest
        const isAnd = node.operator === 'and';
        const values = node.values || [];

        if (values.length === 0) {
            this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(true));
            return;
        }

        this.visit(values[0]);

        for (let i = 1; i < values.length; i++) {
            const endBlock = this.createBlock();

            if (isAnd) {
                // JUMP_IF_FALSE_OR_POP: if false, jump; otherwise pop and continue
                this.currentBlock.jumpCondition = 'if_false_or_pop';
                this.currentBlock.jumpTarget = endBlock;
            } else {
                // JUMP_IF_TRUE_OR_POP: if true, jump; otherwise pop and continue
                this.currentBlock.jumpCondition = 'if_true_or_pop';
                this.currentBlock.jumpTarget = endBlock;
            }

            const nextBlock = this.createBlock();
            this.currentBlock.next = nextBlock;
            this.currentBlock = nextBlock;

            this.visit(values[i]);

            this.currentBlock.next = endBlock;
            this.currentBlock = endBlock;
        }
    }

    private visitIfExpression(node: any) {
        // Ternary: <body> if <test> else <orelse>
        // Evaluate test first
        this.visit(node.test);

        const trueBlock = this.createBlock();
        const falseBlock = this.createBlock();
        const mergeBlock = this.createBlock();

        this.currentBlock.jumpCondition = 'if_false';
        this.currentBlock.jumpTarget = falseBlock;
        this.currentBlock.next = trueBlock;

        const consequent = node.body ?? node.consequent;
        const alternate = node.orelse ?? node.alternate;

        // True branch
        this.currentBlock = trueBlock;
        this.visit(consequent);
        this.currentBlock.next = mergeBlock;

        // False branch
        this.currentBlock = falseBlock;
        this.visit(alternate);
        this.currentBlock.next = mergeBlock;

        this.currentBlock = mergeBlock;
    }

    private visitTry(node: any) {
        const handlers = (node.handlers || []) as Array<{ exceptionType: any; name: string | null; body: any[] }>;
        const orelse = (node.orelse || []) as any[];
        const finalbody = (node.finalbody || []) as any[];

        const hasHandlers = handlers.length > 0;
        const hasElse = orelse.length > 0;
        const hasFinally = finalbody.length > 0;

        const tryBlock = this.createBlock();
        const afterTry = this.createBlock();
        const exceptDispatch = hasHandlers ? this.createBlock() : null;
        const finallyBlock = hasFinally ? this.createBlock() : null;

        // Outer finally (runs on both normal and exceptional exit)
        if (hasFinally) {
            this.currentBlock.exceptionTarget = finallyBlock!;
            this.addInstruction(OpCode.SETUP_FINALLY, finallyBlock!.id);
        }

        // Inner except handler (runs when an exception is raised in try body)
        if (hasHandlers) {
            // Chain exceptionTarget so the linearizer includes both handler blocks
            this.currentBlock.exceptionTarget = exceptDispatch!;
            if (hasFinally) {
                exceptDispatch!.exceptionTarget = finallyBlock!;
            }
            this.addInstruction(OpCode.SETUP_FINALLY, exceptDispatch!.id);
        }

        this.currentBlock.next = tryBlock;

        // Try block (normal flow)
        this.currentBlock = tryBlock;
        for (const stmt of node.body || []) {
            this.visit(stmt);
        }
        if (hasHandlers) {
            // Pop inner except handler
            this.addInstruction(OpCode.POP_BLOCK);
        }
        if (hasElse) {
            for (const stmt of orelse) {
                this.visit(stmt);
            }
        }
        if (hasFinally) {
            // Pop outer finally handler, then run finally with a null marker
            this.addInstruction(OpCode.POP_BLOCK);
            this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
            this.currentBlock.jumpCondition = 'always';
            this.currentBlock.jumpTarget = finallyBlock!;
            this.currentBlock.next = undefined;
        } else {
            this.currentBlock.next = afterTry;
        }

        // Except dispatch block (entered with exception object on stack)
        if (hasHandlers) {
            this.currentBlock = exceptDispatch!;

            // Build a chain of handler checks.
            const noMatchBlock = this.createBlock();
            let cursor: BasicBlock = exceptDispatch!;
            for (let i = 0; i < handlers.length; i++) {
                const handler = handlers[i];
                const isLast = i === handlers.length - 1;
                const nextCheck = isLast ? noMatchBlock : this.createBlock();
                const handlerBlock = this.createBlock();

                this.currentBlock = cursor;

                if (handler.exceptionType) {
                    // Stack at entry: [exc]
                    // Compute isinstance(exc, ExceptionType) leaving exc on stack.
                    this.addInstruction(OpCode.DUP_TOP);
                    this.addInstruction(OpCode.LOAD_NAME, this.getNameIndex('isinstance'));
                    this.addInstruction(OpCode.ROT_TWO);
                    this.visit(handler.exceptionType);
                    this.addInstruction(OpCode.CALL_FUNCTION, 2);

                    this.currentBlock.jumpCondition = 'if_false';
                    this.currentBlock.jumpTarget = nextCheck;
                    this.currentBlock.next = handlerBlock;
                } else {
                    // Bare except: always matches
                    this.currentBlock.next = handlerBlock;
                    // Bare except must be last in CPython; treat it as terminal.
                }

                // Handler body block
                this.currentBlock = handlerBlock;
                if (handler.name) {
                    this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(handler.name));
                } else {
                    this.addInstruction(OpCode.POP_TOP);
                }
                for (const stmt of handler.body || []) {
                    this.visit(stmt);
                }

                if (hasFinally) {
                    // Pop outer finally handler then run finally with null marker
                    this.addInstruction(OpCode.POP_BLOCK);
                    this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
                    this.currentBlock.jumpCondition = 'always';
                    this.currentBlock.jumpTarget = finallyBlock!;
                    this.currentBlock.next = undefined;
                } else {
                    this.currentBlock.next = afterTry;
                }

                // Continue chain with the next check block (exception is still on stack)
                cursor = nextCheck;

                // If this was a bare except, we are done.
                if (!handler.exceptionType) {
                    cursor = noMatchBlock;
                    break;
                }
            }

            // No handler matched -> re-raise the exception on stack.
            this.currentBlock = noMatchBlock;
            this.addInstruction(OpCode.RAISE_VARARGS, 1);
        }

        // Finally block (entered with marker on stack: null for normal flow, or exception object)
        if (hasFinally) {
            this.currentBlock = finallyBlock!;

            const reRaiseBlock = this.createBlock();
            const normalFinally = this.createBlock();

            // Determine whether marker is null
            this.addInstruction(OpCode.DUP_TOP);
            this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null));
            this.addInstruction(OpCode.COMPARE_OP, CompareOp.IS);
            this.currentBlock.jumpCondition = 'if_false';
            this.currentBlock.jumpTarget = reRaiseBlock;
            this.currentBlock.next = normalFinally;

            // Normal path: pop null marker
            this.currentBlock = normalFinally;
            this.addInstruction(OpCode.POP_TOP);
            for (const stmt of finalbody) {
                this.visit(stmt);
            }
            this.currentBlock.next = afterTry;

            // Exceptional path: keep exception marker and re-raise after finalbody
            this.currentBlock = reRaiseBlock;
            for (const stmt of finalbody) {
                this.visit(stmt);
            }
            this.addInstruction(OpCode.RAISE_VARARGS, 1);
        }

        this.currentBlock = afterTry;
    }

    private visitWith(node: any) {
        const items = node.items || [];
        const body = node.body || [];

        this.processWithItems(items, 0, body);
    }

    private processWithItems(items: any[], index: number, body: any[]) {
        if (index >= items.length) {
            // All context managers entered, process body
            for (const stmt of body) {
                this.visit(stmt);
            }
            return;
        }

        const item = items[index];
        const contextExpr = item.context;
        const optionalVars = item.target;

        // Evaluate context expression
        this.visit(contextExpr);

        // Setup block for cleanup
        const cleanupBlock = this.createBlock();
        const bodyBlock = this.createBlock();

        this.currentBlock.exceptionTarget = cleanupBlock;
        this.addInstruction(OpCode.SETUP_WITH, cleanupBlock.id);

        this.currentBlock.next = bodyBlock;
        this.currentBlock = bodyBlock;

        // Store result if target exists
        // SETUP_WITH pushes exit, result.
        // If optionalVars, store result. Else POP_TOP result.
        if (optionalVars) {
            this.visitTarget(optionalVars, 'store');
        } else {
            this.addInstruction(OpCode.POP_TOP);
        }

        // Recursively process next item or body
        this.processWithItems(items, index + 1, body);

        // Normal exit from body
        // Pop block (SETUP_WITH)
        this.addInstruction(OpCode.POP_BLOCK);

        // Call __exit__(None, None, None)
        // Stack has: [__exit__] (after POP_BLOCK removed the block frame, but __exit__ remains on stack from setup)
        // Actually SETUP_WITH block logic in VM: we decided stackHeight includes exit.
        // So POP_BLOCK pops the metadata, but `exit` remains on stack.

        this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(null)); // None
        this.addInstruction(OpCode.DUP_TOP); // None, None
        this.addInstruction(OpCode.DUP_TOP); // None, None, None
        this.addInstruction(OpCode.CALL_FUNCTION, 3); // exit(None, None, None)
        this.addInstruction(OpCode.POP_TOP); // Discard result of exit()

        const afterWithBlock = this.createBlock();
        this.currentBlock.next = afterWithBlock;

        // Cleanup block (exception handling)
        this.currentBlock = cleanupBlock;
        // Stack has: [exit, exc_norm] (pushed by dispatchException)
        this.addInstruction(OpCode.WITH_EXCEPT_START); // Calls exit(exc), returns handled flag

        // If handled (True), suppress exception and continue. 
        // If not handled (False), re-raise.
        // WITH_EXCEPT_START in my VM implementation throws if not handled.
        // So if we are here, it was handled.
        // We probably need to pop the exception if handled?
        // My VM implementation for `WITH_EXCEPT_START`:
        // If handled, it returns. The exception is GONE from stack (popped inside opcode).
        // Wait, checked my VM implementation:
        // `const exc = frame.stack.pop(); const exit = frame.stack.pop();`
        // So stack is empty of exc/exit.

        this.currentBlock.next = afterWithBlock;
        this.currentBlock = afterWithBlock;
    }

    private visitMatch(node: any) {
        // match subject:
        //    case pattern: body

        const subject = node.subject;
        this.visit(subject);

        const endBlock = this.createBlock();

        for (const kase of node.cases) {
            const pattern = kase.pattern;
            const body = kase.body;
            const guard = kase.guard;

            const nextCase = this.createBlock();
            const bodyBlock = this.createBlock();

            // Duplicate subject for pattern matching (keep original on stack for next cases)
            this.addInstruction(OpCode.DUP_TOP);

            this.compilePattern(pattern, nextCase, bodyBlock);

            // Compile the body block
            this.currentBlock = bodyBlock;
            
            // Handle guard if present
            if (guard) {
                const guardFailBlock = this.createBlock();
                this.visit(guard);
                this.currentBlock.jumpCondition = 'if_false';
                this.currentBlock.jumpTarget = guardFailBlock;
                
                const guardPassBlock = this.createBlock();
                this.currentBlock.next = guardPassBlock;
                this.currentBlock = guardPassBlock;
                
                // Pop subject since we matched and guard passed
                this.addInstruction(OpCode.POP_TOP);
                
                // Execute body
                for (const stmt of body) {
                    this.visit(stmt);
                }
                this.currentBlock.next = endBlock;
                
                // Guard failed - go to next case
                this.currentBlock = guardFailBlock;
                this.currentBlock.next = nextCase;
            } else {
                // No guard - pop subject and execute body directly
                this.addInstruction(OpCode.POP_TOP);
                for (const stmt of body) {
                    this.visit(stmt);
                }
                this.currentBlock.next = endBlock;
            }

            // Move to next case block
            this.currentBlock = nextCase;
        }

        // Pop subject if no case matched
        this.addInstruction(OpCode.POP_TOP);
        this.currentBlock.next = endBlock;
        this.currentBlock = endBlock;
    }

    // Helper to compile basic patterns
    private compilePattern(pattern: any, failBlock: BasicBlock, successBlock: BasicBlock) {
        // This is complex to implement fully without specialized opcodes.
        // We'll implement a fallback for the specific test case:
        // 0 | 1
        // [a, b]
        // _ (wildcard)

        // Contract for compilePattern:
        // Input: Stack has [..., subject_copy]
        // Success: Stack has [...] (subject_copy consumed), jump to successBlock
        // Failure: Stack has [...] (subject_copy consumed), jump to failBlock
        // Note: POP_JUMP_IF_FALSE pops the condition value automatically

        switch (pattern.type) {
            case ASTNodeType.MATCH_PATTERN_VALUE: {
                // Stack: [..., subject_copy]
                this.visit(pattern.value);            // Stack: [..., subject_copy, value]
                this.addInstruction(OpCode.COMPARE_OP, CompareOp.EQ); // Stack: [..., bool]
                
                // POP_JUMP_IF_FALSE will pop the bool and jump if false
                // So after the jump instruction, stack is [...] in both paths
                this.currentBlock.jumpCondition = 'if_false';
                this.currentBlock.jumpTarget = failBlock;
                this.currentBlock.next = successBlock;
                break;
            }

            case ASTNodeType.MATCH_PATTERN_OR: {
                // multiple patterns. If any matches -> success.
                // Stack: [..., subject_copy]
                
                for (let i = 0; i < pattern.patterns.length; i++) {
                    const isLast = i === pattern.patterns.length - 1;
                    const nextP = isLast ? failBlock : this.createBlock();
                    
                    if (!isLast) {
                        // Duplicate subject for this pattern (in case it fails)
                        this.addInstruction(OpCode.DUP_TOP); // Stack: [..., subject_copy, subject_copy2]
                    }
                    
                    // compilePattern consumes one copy
                    this.compilePattern(pattern.patterns[i], nextP, successBlock);
                    
                    if (!isLast) {
                        this.currentBlock = nextP;
                        // On failure, subject_copy2 was consumed, but subject_copy is still there
                    }
                }
                break;
            }

            case ASTNodeType.MATCH_PATTERN_SEQUENCE: {
                // Stack: [..., subject_copy]
                // Check if list/tuple/sequence, check length, unpack
                
                // Check isinstance(subject, list)
                this.addInstruction(OpCode.DUP_TOP); // [..., subject_copy, subject_copy2]
                this.addInstruction(OpCode.LOAD_NAME, this.getNameIndex('isinstance'));
                this.addInstruction(OpCode.ROT_TWO); // [..., subject_copy, isinstance, subject_copy2]
                this.addInstruction(OpCode.LOAD_NAME, this.getNameIndex('list'));
                this.addInstruction(OpCode.CALL_FUNCTION, 2); // [..., subject_copy, bool]
                
                // POP_JUMP_IF_FALSE will pop the bool
                const notListBlock = this.createBlock();
                const isListBlock = this.createBlock();
                this.currentBlock.jumpCondition = 'if_false';
                this.currentBlock.jumpTarget = notListBlock;
                this.currentBlock.next = isListBlock;
                
                // Not a list - just pop subject_copy and fail
                // (bool was already popped by POP_JUMP_IF_FALSE)
                this.currentBlock = notListBlock;
                this.addInstruction(OpCode.POP_TOP); // pop subject_copy
                this.currentBlock.next = failBlock;

                // Is a list - check length
                // (bool was already popped by POP_JUMP_IF_FALSE)
                // Stack: [..., subject_copy]
                this.currentBlock = isListBlock;
                
                // Check length
                this.addInstruction(OpCode.DUP_TOP); // [..., subject_copy, subject_copy2]
                this.addInstruction(OpCode.LOAD_NAME, this.getNameIndex('len'));
                this.addInstruction(OpCode.ROT_TWO);
                this.addInstruction(OpCode.CALL_FUNCTION, 1); // [..., subject_copy, length]
                this.addInstruction(OpCode.LOAD_CONST, this.getConstantIndex(pattern.elements.length));
                this.addInstruction(OpCode.COMPARE_OP, CompareOp.EQ); // [..., subject_copy, bool]

                const lenNoMatchBlock = this.createBlock();
                const lenMatchBlock = this.createBlock();
                this.currentBlock.jumpCondition = 'if_false';
                this.currentBlock.jumpTarget = lenNoMatchBlock;
                this.currentBlock.next = lenMatchBlock;
                
                // Length doesn't match - pop subject and fail
                // (bool was already popped by POP_JUMP_IF_FALSE)
                this.currentBlock = lenNoMatchBlock;
                this.addInstruction(OpCode.POP_TOP); // pop subject_copy
                this.currentBlock.next = failBlock;

                // Length matches - unpack and bind
                // (bool was already popped by POP_JUMP_IF_FALSE)
                // Stack: [..., subject_copy]
                this.currentBlock = lenMatchBlock;
                
                // UNPACK_SEQUENCE consumes subject and pushes elements
                this.addInstruction(OpCode.UNPACK_SEQUENCE, pattern.elements.length);
                // Stack: [..., elem0, elem1, ...]
                
                // Store elements into pattern variables
                for (let i = 0; i < pattern.elements.length; i++) {
                    const p = pattern.elements[i];
                    if (p.type === ASTNodeType.MATCH_PATTERN_CAPTURE && p.name) {
                        this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(p.name));
                    } else {
                        this.addInstruction(OpCode.POP_TOP);
                    }
                }
                // Stack: [...]
                this.currentBlock.next = successBlock;
                break;
            }

            case ASTNodeType.MATCH_PATTERN_CAPTURE:
                // Stack: [..., subject_copy]
                if (pattern.name) {
                    // Bind subject to name
                    this.addInstruction(OpCode.STORE_NAME, this.getNameIndex(pattern.name));
                } else {
                    // Wildcard - just consume
                    this.addInstruction(OpCode.POP_TOP);
                }
                // Stack: [...]
                this.currentBlock.next = successBlock;
                break;

            case ASTNodeType.MATCH_PATTERN_WILDCARD:
                // Stack: [..., subject_copy]
                // Wildcard - just consume
                this.addInstruction(OpCode.POP_TOP);
                // Stack: [...]
                this.currentBlock.next = successBlock;
                break;

            default:
                // Unknown pattern -> treat as match, consume subject_copy
                this.addInstruction(OpCode.POP_TOP);
                this.currentBlock.next = successBlock;
        }
    }
}