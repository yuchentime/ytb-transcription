import type { VoiceParamInput, VoiceProfile } from '../../core/db/types'

const VOICES: VoiceProfile[] = [
  // 中文  - 基础青年音色
  { id: 'male-qn-qingse', displayName: '青涩青年音色(普通话)', description: '青涩青年音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'male-qn-jingying', displayName: '精英青年音色(普通话)', description: '精英青年音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'male-qn-badao', displayName: '霸道青年音色(普通话)', description: '霸道青年音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'male-qn-daxuesheng', displayName: '青年大学生音色(普通话)', description: '青年大学生音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - 基础女性音色
  { id: 'female-shaonv', displayName: '少女音色(普通话)', description: '少女音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'female-yujie', displayName: '御姐音色(普通话)', description: '御姐音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'female-chengshu', displayName: '成熟女性音色(普通话)', description: '成熟女性音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'female-tianmei', displayName: '甜美女性音色(普通话)', description: '甜美女性音色', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - beta 青年音色
  { id: 'male-qn-qingse-jingpin', displayName: '青涩青年音色-beta(普通话)', description: '青涩青年音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'male-qn-jingying-jingpin', displayName: '精英青年音色-beta(普通话)', description: '精英青年音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'male-qn-badao-jingpin', displayName: '霸道青年音色-beta(普通话)', description: '霸道青年音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'male-qn-daxuesheng-jingpin', displayName: '青年大学生音色-beta(普通话)', description: '青年大学生音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - beta 女性音色
  { id: 'female-shaonv-jingpin', displayName: '少女音色-beta(普通话)', description: '少女音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'female-yujie-jingpin', displayName: '御姐音色-beta(普通话)', description: '御姐音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'female-chengshu-jingpin', displayName: '成熟女性音色-beta(普通话)', description: '成熟女性音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'female-tianmei-jingpin', displayName: '甜美女性音色-beta(普通话)', description: '甜美女性音色-beta', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - 儿童/卡通音色
  { id: 'clever_boy', displayName: '聪明男童(普通话)', description: '聪明男童', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'cute_boy', displayName: '可爱男童(普通话)', description: '可爱男童', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'lovely_girl', displayName: '萌萌女童(普通话)', description: '萌萌女童', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'cartoon_pig', displayName: '卡通猪小琪(普通话)', description: '卡通猪小琪', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - 角色音色 21-30
  { id: 'bingjiao_didi', displayName: '病娇弟弟(普通话)', description: '病娇弟弟', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'junlang_nanyou', displayName: '俊朗男友(普通话)', description: '俊朗男友', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'chunzhen_xuedi', displayName: '纯真学弟(普通话)', description: '纯真学弟', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'lengdan_xiongzhang', displayName: '冷淡学长(普通话)', description: '冷淡学长', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'badao_shaoye', displayName: '霸道少爷(普通话)', description: '霸道少爷', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'tianxin_xiaoling', displayName: '甜心小玲(普通话)', description: '甜心小玲', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'qiaopi_mengmei', displayName: '俏皮萌妹(普通话)', description: '俏皮萌妹', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'wumei_yujie', displayName: '妩媚御姐(普通话)', description: '妩媚御姐', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'diadia_xuemei', displayName: '嗲嗲学妹(普通话)', description: '嗲嗲学妹', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'danya_xuejie', displayName: '淡雅学姐(普通话)', description: '淡雅学姐', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - 专业/特色音色 31-40
  { id: 'Chinese (Mandarin)_Reliable_Executive', displayName: '沉稳高管(普通话)', description: '沉稳高管', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_News_Anchor', displayName: '新闻女声(普通话)', description: '新闻女声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Mature_Woman', displayName: '傲娇御姐(普通话)', description: '傲娇御姐', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Unrestrained_Young_Man', displayName: '不羁青年(普通话)', description: '不羁青年', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Arrogant_Miss', displayName: '嚣张小姐(普通话)', description: '嚣张小姐', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Robot_Armor', displayName: '机械战甲(普通话)', description: '机械战甲', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Kind-hearted_Antie', displayName: '热心大婶(普通话)', description: '热心大婶', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_HK_Flight_Attendant', displayName: '港普空姐', description: '港普空姐', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Humorous_Elder', displayName: '搞笑大爷(普通话)', description: '搞笑大爷', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Gentleman', displayName: '温润男声(普通话)', description: '温润男声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - 41-50
  { id: 'Chinese (Mandarin)_Warm_Bestie', displayName: '温暖闺蜜(普通话)', description: '温暖闺蜜', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Male_Announcer', displayName: '播报男声(普通话)', description: '播报男声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Sweet_Lady', displayName: '甜美女声(普通话)', description: '甜美女声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Southern_Young_Man', displayName: '南方小哥(普通话)', description: '南方小哥', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Wise_Women', displayName: '阅历姐姐(普通话)', description: '阅历姐姐', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Gentle_Youth', displayName: '温润青年(普通话)', description: '温润青年', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Warm_Girl', displayName: '温暖少女(普通话)', description: '温暖少女', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Kind-hearted_Elder', displayName: '花甲奶奶(普通话)', description: '花甲奶奶', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Cute_Spirit', displayName: '憨憨萌兽(普通话)', description: '憨憨萌兽', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Radio_Host', displayName: '电台男主播(普通话)', description: '电台男主播', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - 51-58
  { id: 'Chinese (Mandarin)_Lyrical_Voice', displayName: '抒情男声(普通话)', description: '抒情男声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Straightforward_Boy', displayName: '率真弟弟(普通话)', description: '率真弟弟', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Sincere_Adult', displayName: '真诚青年(普通话)', description: '真诚青年', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Gentle_Senior', displayName: '温柔学姐(普通话)', description: '温柔学姐', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Stubborn_Friend', displayName: '嘴硬竹马(普通话)', description: '嘴硬竹马', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Crisp_Girl', displayName: '清脆少女(普通话)', description: '清脆少女', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Pure-hearted_Boy', displayName: '清澈邻家弟弟(普通话)', description: '清澈邻家弟弟', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Chinese (Mandarin)_Soft_Girl', displayName: '柔和少女(普通话)', description: '柔和少女', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },

  // 中文  - 59-64 (粤语)
  { id: 'Cantonese_ProfessionalHost（F)', displayName: '专业女主持(粤语)', description: '专业女主持', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Cantonese_GentleLady', displayName: '温柔女声(粤语)', description: '温柔女声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Cantonese_ProfessionalHost（M)', displayName: '专业男主持(粤语)', description: '专业男主持', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Cantonese_PlayfulMan', displayName: '活泼男声(粤语)', description: '活泼男声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Cantonese_CuteGirl', displayName: '可爱女孩(粤语)', description: '可爱女孩', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
  { id: 'Cantonese_KindWoman', displayName: '善良女声(粤语)', description: '善良女声', language: 'zh', speedRange: [0.5, 2], pitchRange: [-10, 10], volumeRange: [0, 10] },
]

export function listVoiceProfiles(): VoiceProfile[] {
  return VOICES
}

export function validateVoiceParams(input: VoiceParamInput): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const voiceId = input.voiceId ?? null
  const selectedVoice = voiceId ? VOICES.find((voice) => voice.id === voiceId) : null
  if (voiceId && !selectedVoice) {
    errors.push(`Unknown voiceId: ${voiceId}`)
  }

  const speed = input.speed ?? 1
  const pitch = input.pitch ?? 0
  const volume = input.volume ?? 1

  const speedRange: [number, number] = selectedVoice?.speedRange ?? [0.5, 2]
  const pitchRange: [number, number] = selectedVoice?.pitchRange ?? [-10, 10]
  const volumeRange: [number, number] = selectedVoice?.volumeRange ?? [0, 10]

  if (speed < speedRange[0] || speed > speedRange[1]) {
    errors.push(`speed out of range: ${speedRange[0]}-${speedRange[1]}`)
  }
  if (pitch < pitchRange[0] || pitch > pitchRange[1]) {
    errors.push(`pitch out of range: ${pitchRange[0]}-${pitchRange[1]}`)
  }
  if (volume < volumeRange[0] || volume > volumeRange[1]) {
    errors.push(`volume out of range: ${volumeRange[0]}-${volumeRange[1]}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
