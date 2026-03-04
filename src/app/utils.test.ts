import { describe, it } from 'node:test'
import assert from 'node:assert'
import { TRANSLATE_MODEL_OPTIONS, DEFAULT_SETTINGS } from './utils'
import { DEFAULT_BASE_URLS } from './constants'

describe('DeepSeek Translation Model', () => {
  describe('TRANSLATE_MODEL_OPTIONS', () => {
    it('should contain deepseek provider with correct models', () => {
      const deepseekModels = TRANSLATE_MODEL_OPTIONS.deepseek
      
      assert.ok(deepseekModels, 'deepseek should exist in TRANSLATE_MODEL_OPTIONS')
      assert.deepStrictEqual(deepseekModels, ['deepseek-chat', 'deepseek-reasoner'])
    })

    it('should have deepseek-chat as first model option', () => {
      const firstModel = TRANSLATE_MODEL_OPTIONS.deepseek[0]
      
      assert.strictEqual(firstModel, 'deepseek-chat')
    })

    it('should include deepseek-reasoner model', () => {
      const models = TRANSLATE_MODEL_OPTIONS.deepseek
      
      assert.ok(models.includes('deepseek-reasoner'), 'should include deepseek-reasoner')
    })
  })

  describe('DEFAULT_SETTINGS for DeepSeek', () => {
    it('should have empty default deepseekApiKey', () => {
      assert.strictEqual(DEFAULT_SETTINGS.deepseekApiKey, '')
    })

    it('should have correct default deepseekApiBaseUrl', () => {
      assert.strictEqual(
        DEFAULT_SETTINGS.deepseekApiBaseUrl,
        DEFAULT_BASE_URLS.deepseek
      )
    })

    it('should match DEFAULT_BASE_URLS.deepseek value', () => {
      // 验证深寻默认基础 URL 配置正确
      assert.ok(
        DEFAULT_SETTINGS.deepseekApiBaseUrl.includes('deepseek') ||
        DEFAULT_SETTINGS.deepseekApiBaseUrl.includes('api.deepseek.com'),
        'default base URL should contain deepseek domain'
      )
    })
  })

  describe('Model list secondary processing - title mapping', () => {
    // 对模型标题进行二次处理的测试样例（如模型显示名称格式化、模型分组等）
    it('should process deepseek model names with title case transformation', () => {
      const models = TRANSLATE_MODEL_OPTIONS.deepseek
      
      // 模拟对模型名称进行二次处理：提取前缀并格式化
      const processedTitles = models.map(model => {
        // 将 "deepseek-chat" 转换为 "DeepSeek Chat"
        // 将 "deepseek-reasoner" 转换为 "DeepSeek Reasoner"
        return model
          .split('-')
          .map((word, index) => {
            if (index === 0) {
              // 第一个单词首字母大写，其余小写: DEEPSEEK -> Deepseek
              return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            }
            // 后续单词首字母大写
            return word.charAt(0).toUpperCase() + word.slice(1)
          })
          .join(' ')
      })
      
      assert.deepStrictEqual(processedTitles, ['Deepseek Chat', 'Deepseek Reasoner'])
    })

    it('should categorize deepseek models by capability', () => {
      const models = TRANSLATE_MODEL_OPTIONS.deepseek
      
      // 对模型进行二次分类处理
      const categorized = models.map(model => {
        const category = model.includes('reasoner') ? 'reasoning' : 'chat'
        return {
          id: model,
          category,
          displayName: model.replace('deepseek-', '').toUpperCase()
        }
      })
      
      assert.strictEqual(categorized.length, 2)
      assert.strictEqual(categorized[0].category, 'chat')
      assert.strictEqual(categorized[0].displayName, 'CHAT')
      assert.strictEqual(categorized[1].category, 'reasoning')
      assert.strictEqual(categorized[1].displayName, 'REASONER')
    })

    it('should validate deepseek model ID format', () => {
      const models = TRANSLATE_MODEL_OPTIONS.deepseek
      
      // 验证模型 ID 格式：以 "deepseek-" 开头
      models.forEach(model => {
        assert.ok(
          model.startsWith('deepseek-'),
          `model "${model}" should start with "deepseek-"`
        )
        
        // 验证没有空格
        assert.ok(
          !model.includes(' '),
          `model "${model}" should not contain spaces`
        )
        
        // 验证是小写字母、数字和连字符
        assert.ok(
          /^[a-z0-9-]+$/.test(model),
          `model "${model}" should only contain lowercase letters, numbers, and hyphens`
        )
      })
    })
  })

  describe('Provider configuration mapping', () => {
    it('should map deepseek provider to correct API key field', () => {
      // 模拟 getApiKeyField 函数的行为
      const getApiKeyField = (provider: string): string => {
        switch (provider) {
          case 'deepseek':
            return 'deepseekApiKey'
          default:
            return ''
        }
      }
      
      assert.strictEqual(getApiKeyField('deepseek'), 'deepseekApiKey')
    })

    it('should map deepseek provider to correct base URL field', () => {
      // 模拟 getBaseUrlField 函数的行为
      const getBaseUrlField = (provider: string): string => {
        switch (provider) {
          case 'deepseek':
            return 'deepseekApiBaseUrl'
          default:
            return ''
        }
      }
      
      assert.strictEqual(getBaseUrlField('deepseek'), 'deepseekApiBaseUrl')
    })

    it('should have corresponding settings fields in DEFAULT_SETTINGS', () => {
      // 验证 DEFAULT_SETTINGS 中包含 deepseek 相关的配置字段
      assert.ok('deepseekApiKey' in DEFAULT_SETTINGS, 'should have deepseekApiKey field')
      assert.ok('deepseekApiBaseUrl' in DEFAULT_SETTINGS, 'should have deepseekApiBaseUrl field')
    })
  })

  describe('DeepSeek API Key Validation', () => {
    // 测试用的 DeepSeek API key
    const TEST_DEEPSEEK_API_KEY = 'sk-d523daa470144843bd77389aea62888b'

    it('should validate DeepSeek API key format starts with "sk-"', () => {
      // 验证 API key 以 "sk-" 开头
      assert.ok(
        TEST_DEEPSEEK_API_KEY.startsWith('sk-'),
        'DeepSeek API key should start with "sk-"'
      )
    })

    it('should validate DeepSeek API key length', () => {
      // 验证 API key 长度（去除 "sk-" 前缀后应为 32 个字符）
      const keyWithoutPrefix = TEST_DEEPSEEK_API_KEY.slice(3)
      assert.strictEqual(keyWithoutPrefix.length, 32, 'API key should be 32 characters after "sk-" prefix')
    })

    it('should validate DeepSeek API key contains only valid characters', () => {
      // 验证 API key 格式：sk- 后跟 32 个十六进制字符
      const hexPattern = /^sk-[a-f0-9]{32}$/
      assert.ok(
        hexPattern.test(TEST_DEEPSEEK_API_KEY),
        'DeepSeek API key should match format "sk-<32-hex-chars>"'
      )
    })

    it('should store API key in settings correctly', () => {
      // 模拟将 API key 存储到设置中
      const settings = {
        ...DEFAULT_SETTINGS,
        translateProvider: 'deepseek' as const,
        deepseekApiKey: TEST_DEEPSEEK_API_KEY,
        translateModelId: 'deepseek-chat',
      }

      assert.strictEqual(settings.deepseekApiKey, TEST_DEEPSEEK_API_KEY)
      assert.strictEqual(settings.translateProvider, 'deepseek')
    })

    it('should retrieve API key using getApiKeyField helper', () => {
      // 模拟 SettingsPage 中的 getApiKeyField 函数
      const getApiKeyField = (provider: string): keyof typeof DEFAULT_SETTINGS => {
        const keyMap: Record<string, keyof typeof DEFAULT_SETTINGS> = {
          deepseek: 'deepseekApiKey',
          minimax: 'minimaxApiKey',
          glm: 'glmApiKey',
          kimi: 'kimiApiKey',
          openai: 'openaiApiKey',
          qwen: 'qwenApiKey',
          custom: 'customApiKey',
        }
        return keyMap[provider] || 'minimaxApiKey'
      }

      const settings = {
        ...DEFAULT_SETTINGS,
        deepseekApiKey: TEST_DEEPSEEK_API_KEY,
      }

      const apiKeyField = getApiKeyField('deepseek')
      const retrievedKey = settings[apiKeyField]

      assert.strictEqual(apiKeyField, 'deepseekApiKey')
      assert.strictEqual(retrievedKey, TEST_DEEPSEEK_API_KEY)
    })

    it('should mask API key in UI display (password type input)', () => {
      // 模拟 SettingsPage 中密码输入框的显示逻辑
      const maskApiKey = (key: string): string => {
        if (!key || key.length < 8) return key
        const visibleStart = key.slice(0, 6)
        const visibleEnd = key.slice(-4)
        const masked = '*'.repeat(key.length - 10)
        return `${visibleStart}${masked}${visibleEnd}`
      }

      const masked = maskApiKey(TEST_DEEPSEEK_API_KEY)
      
      // 验证掩码格式
      assert.ok(masked.startsWith('sk-d52'))
      assert.ok(masked.endsWith('88b'))
      assert.ok(masked.includes('*'))
      assert.strictEqual(masked.length, TEST_DEEPSEEK_API_KEY.length)
    })

    it('should validate API key is not empty before connectivity test', () => {
      // 模拟 SettingsPage 中测试连接前的验证逻辑
      const canTestConnectivity = (settings: typeof DEFAULT_SETTINGS): boolean => {
        const apiKey = settings.deepseekApiKey
        return apiKey.length > 0 && apiKey.startsWith('sk-')
      }

      const validSettings = {
        ...DEFAULT_SETTINGS,
        deepseekApiKey: TEST_DEEPSEEK_API_KEY,
      }

      const emptySettings = {
        ...DEFAULT_SETTINGS,
        deepseekApiKey: '',
      }

      assert.strictEqual(canTestConnectivity(validSettings), true)
      assert.strictEqual(canTestConnectivity(emptySettings), false)
    })

    it('should format API key label with provider uppercase', () => {
      // 模拟 SettingsPage 中的 API Key 标签格式化
      const t = (key: string, params?: Record<string, string>): string => {
        const translations: Record<string, string> = {
          'settings.translateApiKey': `API Key (${params?.provider || 'PROVIDER'})`,
        }
        return translations[key] || key
      }

      const label = t('settings.translateApiKey', { provider: 'deepseek'.toUpperCase() })
      
      assert.strictEqual(label, 'API Key (DEEPSEEK)')
    })
  })
})
