import { Instruction } from './bytecode';

/**
 * 控制流图 (CFG) 相关类型定义
 */

export interface BasicBlock {
    id: number;
    instructions: Instruction[];
    next?: BasicBlock;        // 默认的下一个块（下坠）
    jumpTarget?: BasicBlock;  // 跳转目标块
    jumpCondition?: 'if_true' | 'if_false' | 'always' | 'if_false_or_pop' | 'if_true_or_pop';

    // Exception edge (not a normal control-flow edge)
    // Used so the linearizer can place handler blocks and patch SETUP_FINALLY targets.
    exceptionTarget?: BasicBlock;

    // 用于生成的辅助属性
    isProcessed?: boolean;
    reachable?: boolean;      // 是否可达（用于处理 break/continue/return 后的unreachable代码）
    offset?: number;          // 块在字节码中的起始偏移
}

export interface CFG {
    entry: BasicBlock;
    blocks: BasicBlock[];
}
