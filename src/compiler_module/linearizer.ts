/* eslint-disable @typescript-eslint/no-explicit-any */
import { ByteCode, CFG, BasicBlock, OpCode, Instruction } from '../types';

export class Linearizer {
    linearize(
        cfg: CFG,
        constants: any[],
        names: string[],
        varnames: string[],
        argcount: number = 0,
        params?: any[],
        globals?: string[],
        nonlocals?: string[]
    ): ByteCode {
        const orderedBlocks = this.orderBlocks(cfg.entry);
        const instructions: Instruction[] = [];
        const blockOffsets = new Map<number, number>();

        let currentOffset = 0;
        for (let i = 0; i < orderedBlocks.length; i++) {
            const block = orderedBlocks[i];
            blockOffsets.set(block.id, currentOffset);

            if (!block) {
                console.error('Linearizer: block is undefined at index', i);
                continue;
            }
            if (!block.instructions) {
                console.error('Linearizer: block.instructions is undefined for block', block.id);
                continue;
            }
            currentOffset += block.instructions.length;
            if (block.jumpTarget) currentOffset += 1;

            const isLast = i === orderedBlocks.length - 1;
            const followsNext = !isLast && orderedBlocks[i + 1] === block.next;

            if (block.next && !followsNext) {
                currentOffset += 1;
            }
        }

        for (let i = 0; i < orderedBlocks.length; i++) {
            const block = orderedBlocks[i];

            for (const instr of block.instructions) {
                if (instr.opcode === OpCode.SETUP_FINALLY && instr.arg !== undefined) {
                    const patched = blockOffsets.get(instr.arg);
                    if (patched !== undefined) {
                        instructions.push({ ...instr, arg: patched, offset: instructions.length });
                        continue;
                    }
                }
                if (instr.opcode === OpCode.FOR_ITER && instr.arg !== undefined) {
                    const patched = blockOffsets.get(instr.arg);
                    if (patched !== undefined) {
                        instructions.push({ ...instr, arg: patched, offset: instructions.length });
                        continue;
                    }
                }
                instructions.push({ ...instr, offset: instructions.length });
            }

            if (block.jumpTarget) {
                let opcode: OpCode;
                if (block.jumpCondition === 'if_false') {
                    opcode = OpCode.POP_JUMP_IF_FALSE;
                } else if (block.jumpCondition === 'if_true') {
                    opcode = OpCode.POP_JUMP_IF_TRUE;
                } else if (block.jumpCondition === 'if_false_or_pop') {
                    opcode = OpCode.JUMP_IF_FALSE_OR_POP;
                } else if (block.jumpCondition === 'if_true_or_pop') {
                    opcode = OpCode.JUMP_IF_TRUE_OR_POP;
                } else {
                    opcode = OpCode.JUMP_ABSOLUTE;
                }
                const targetOffset = blockOffsets.get(block.jumpTarget.id)!;
                instructions.push({ opcode, arg: targetOffset, offset: instructions.length });
            }

            const isLast = i === orderedBlocks.length - 1;
            const followsNext = !isLast && orderedBlocks[i + 1] === block.next;

            if (block.next && !followsNext) {
                const targetOffset = blockOffsets.get(block.next.id)!;
                instructions.push({ opcode: OpCode.JUMP_ABSOLUTE, arg: targetOffset, offset: instructions.length });
            }
        }

        const bc: ByteCode = {
            instructions,
            constants,
            names,
            varnames,
            argcount,
        };
        if (params !== undefined) bc.params = params;
        if (globals !== undefined) bc.globals = globals;
        if (nonlocals !== undefined) bc.nonlocals = nonlocals;
        return bc;
    }

    private orderBlocks(entry: BasicBlock): BasicBlock[] {
        const result: BasicBlock[] = [];
        const visited = new Set<BasicBlock>();

        function visit(block: BasicBlock) {
            if (visited.has(block)) return;
            visited.add(block);
            result.push(block);

            if (block.next) visit(block.next);
            if (block.jumpTarget) visit(block.jumpTarget);
            if (block.exceptionTarget) visit(block.exceptionTarget);
        }

        visit(entry);
        return result;
    }
}
