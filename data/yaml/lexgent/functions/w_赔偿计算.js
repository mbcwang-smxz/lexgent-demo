/**
 * Damage Calculator Worker
 *
 * Internal tool implementation for calculating legal compensation amounts.
 * Supports various damage types with regional adjustments.
 */

// Regional daily wage standards (2024 data, simplified)
const REGIONAL_DAILY_WAGES = {
  '北京': 450,
  '上海': 420,
  '广东': 380,
  '浙江': 360,
  '江苏': 340,
  '全国': 300,
};

// Disability compensation multipliers (simplified)
const DISABILITY_MULTIPLIERS = {
  1: 100,  // 一级伤残 100%
  2: 90,   // 二级伤残 90%
  3: 80,
  4: 70,
  5: 60,
  6: 50,
  7: 40,
  8: 30,
  9: 20,
  10: 10,  // 十级伤残 10%
};

// Mental damage base amounts
const MENTAL_DAMAGE_BASES = {
  '一般': 5000,
  '较重': 20000,
  '严重': 50000,
};

/**
 * Calculate compensation for various damage types
 */
async function execute(args) {
  const {
    damage_type,
    base_amount,
    duration_days,
    disability_level,
    region = '全国',
  } = args;

  const adjustments = [];
  let total_amount = base_amount;
  let calculation_basis = '';
  const legal_references = [];

  switch (damage_type) {
    case '人身损害': {
      calculation_basis = '人身损害赔偿按照医疗费实际支出加残疾赔偿金计算';
      legal_references.push('《民法典》第一千一百七十九条');

      if (disability_level && disability_level >= 1 && disability_level <= 10) {
        const multiplier = DISABILITY_MULTIPLIERS[disability_level] / 100;
        const dailyWage = REGIONAL_DAILY_WAGES[region] || REGIONAL_DAILY_WAGES['全国'];
        const disabilityAmount = dailyWage * 365 * 20 * multiplier; // 20年计算

        adjustments.push({
          name: `${disability_level}级伤残赔偿金`,
          factor: multiplier,
          amount: disabilityAmount,
        });
        total_amount += disabilityAmount;
        legal_references.push('《最高人民法院关于审理人身损害赔偿案件适用法律若干问题的解释》');
      }
      break;
    }

    case '财产损失': {
      calculation_basis = '财产损失按照实际损失金额计算';
      legal_references.push('《民法典》第一千一百八十四条');
      // Direct property loss, no adjustments
      break;
    }

    case '精神损害': {
      calculation_basis = '精神损害抚慰金根据侵权人的过错程度、侵权行为造成的后果等因素确定';
      legal_references.push('《民法典》第一千一百八十三条');

      // Apply regional adjustment
      const regionalFactor = (REGIONAL_DAILY_WAGES[region] || 300) / 300;
      if (regionalFactor !== 1) {
        const adjustment = base_amount * (regionalFactor - 1);
        adjustments.push({
          name: `${region}地区调整`,
          factor: regionalFactor,
          amount: adjustment,
        });
        total_amount = base_amount * regionalFactor;
      }
      break;
    }

    case '误工费': {
      calculation_basis = '误工费按照受害人的误工时间和收入状况确定';
      legal_references.push('《民法典》第一千一百七十九条');

      if (duration_days && duration_days > 0) {
        const dailyWage = REGIONAL_DAILY_WAGES[region] || REGIONAL_DAILY_WAGES['全国'];
        total_amount = dailyWage * duration_days;

        adjustments.push({
          name: `误工天数 ${duration_days} 天`,
          factor: duration_days,
          amount: total_amount,
        });
      }
      break;
    }

    case '医疗费': {
      calculation_basis = '医疗费根据医疗机构出具的医药费、住院费等收款凭证确定';
      legal_references.push('《民法典》第一千一百七十九条');
      // Direct medical expenses, no adjustments
      break;
    }

    default:
      throw new Error(`Unknown damage type: ${damage_type}`);
  }

  return {
    damage_type,
    base_amount,
    adjustments,
    total_amount: Math.round(total_amount * 100) / 100,
    calculation_basis,
    legal_references,
  };
}

module.exports = { execute };
