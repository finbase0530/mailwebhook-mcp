#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MCP 邮件服务测试脚本
测试 qqwebhook 和 mailwebhook-mcp 的中文邮件编码和功能
"""

import os
import sys
import json
import time
import logging
from datetime import datetime
from typing import Dict, Any, Optional

try:
    import requests
except ImportError:
    print("❌ 缺少 requests 库，请安装：pip install requests")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("⚠️  未安装 python-dotenv，将使用环境变量或默认配置")
    print("建议安装：pip install python-dotenv")
    load_dotenv = None

# 设置编码
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# 加载环境变量
if load_dotenv:
    load_dotenv()

class EmailTestConfig:
    """测试配置类"""
    
    def __init__(self):
        # 服务配置
        self.mcp_base_url = os.getenv('MCP_BASE_URL', 'https://mailwebhook-mcp.finbase.win')
        self.qqwebhook_base_url = os.getenv('QQWEBHOOK_BASE_URL', 'https://qqwebhook.finbase.win')
        
        # 认证配置
        self.mcp_api_token = os.getenv('MCP_API_TOKEN')
        self.qqwebhook_api_token = os.getenv('QQWEBHOOK_API_TOKEN')
        
        # 测试配置
        self.test_email = os.getenv('TEST_EMAIL')
        self.test_sender_name = os.getenv('TEST_SENDER_NAME', 'MCP Test')
        self.test_timeout = int(os.getenv('TEST_TIMEOUT', '30'))
        
        # 调试配置
        self.debug_verbose = os.getenv('DEBUG_VERBOSE', 'false').lower() == 'true'
        self.save_test_results = os.getenv('SAVE_TEST_RESULTS', 'false').lower() == 'true'
        
        # 验证必需配置
        self._validate_config()
    
    def _validate_config(self):
        """验证配置"""
        missing_configs = []
        
        if not self.test_email:
            missing_configs.append('TEST_EMAIL')
        
        if not self.mcp_api_token:
            print("⚠️  警告：MCP_API_TOKEN 未设置，将跳过 MCP 测试")
        
        if not self.qqwebhook_api_token:
            print("⚠️  警告：QQWEBHOOK_API_TOKEN 未设置，将跳过 qqwebhook 直接测试")
        
        if missing_configs:
            print(f"❌ 缺少必需配置：{', '.join(missing_configs)}")
            print("请创建 .env 文件或设置环境变量。参考 .env.example 文件。")
            sys.exit(1)

class EmailTester:
    """邮件测试器"""
    
    def __init__(self, config: EmailTestConfig):
        self.config = config
        self.test_results = []
        
        # 配置日志
        if config.debug_verbose:
            logging.basicConfig(level=logging.DEBUG)
        else:
            logging.basicConfig(level=logging.INFO)
        
        self.logger = logging.getLogger(__name__)
    
    def _make_request(self, method: str, url: str, headers: Dict[str, str], 
                     data: Optional[Dict[str, Any]] = None) -> requests.Response:
        """发送 HTTP 请求"""
        try:
            if method.upper() == 'POST':
                response = requests.post(url, json=data, headers=headers, 
                                       timeout=self.config.test_timeout)
            else:
                response = requests.get(url, headers=headers, 
                                      timeout=self.config.test_timeout)
            
            self.logger.debug(f"请求 {method} {url}")
            self.logger.debug(f"响应状态: {response.status_code}")
            
            return response
            
        except requests.exceptions.RequestException as e:
            self.logger.error(f"请求失败: {e}")
            raise

    def test_qqwebhook_direct(self) -> bool:
        """直接测试 qqwebhook 服务"""
        print("=" * 50)
        print("直接测试 qqwebhook 中文邮件发送")
        print("=" * 50)
        
        if not self.config.qqwebhook_api_token:
            print("⚠️  跳过 qqwebhook 测试（未配置 API Token）")
            return False
        
        url = f"{self.config.qqwebhook_base_url}/send"
        headers = {
            "Authorization": f"Bearer {self.config.qqwebhook_api_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        
        # 测试数据
        test_data = {
            "to": self.config.test_email,
            "subject": f"[{self.config.test_sender_name}] qqwebhook 中文测试",
            "body": f"您好！\n\n这是通过 Python 脚本直接调用 qqwebhook 发送的中文邮件。\n\n测试内容：\n• 中文字符：你好世界\n• 特殊符号：©®™\n• Emoji：🎉📧✅\n\n如果显示正常，说明 qqwebhook 处理中文没有问题。\n\n测试时间：{datetime.now().strftime('%Y年%m月%d日 %H:%M:%S')}"
        }
        
        print(f"📡 请求URL: {url}")
        if self.config.debug_verbose:
            print(f"📋 请求头: {json.dumps(headers, ensure_ascii=False, indent=2)}")
            print(f"📋 请求数据: {json.dumps(test_data, ensure_ascii=False, indent=2)}")
        print("-" * 30)
        
        try:
            response = self._make_request('POST', url, headers, test_data)
            
            print(f"✅ 响应状态码: {response.status_code}")
            
            if self.config.debug_verbose:
                print(f"📋 响应头: {json.dumps(dict(response.headers), ensure_ascii=False, indent=2)}")
            
            # 解析响应
            try:
                resp_data = response.json()
                print(f"📨 响应数据: {json.dumps(resp_data, ensure_ascii=False, indent=2)}")
                
                # 记录测试结果
                test_result = {
                    'test_type': 'qqwebhook_direct',
                    'success': response.status_code == 200,
                    'response_data': resp_data,
                    'timestamp': datetime.now().isoformat()
                }
                self.test_results.append(test_result)
                
                return response.status_code == 200
                
            except json.JSONDecodeError:
                print(f"❌ JSON 解析失败: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ 请求失败: {e}")
            return False

    def test_mcp_service(self) -> bool:
        """测试 MCP 服务"""
        print("=" * 50)
        print("测试 MCP 服务中文邮件发送")
        print("=" * 50)
        
        if not self.config.mcp_api_token:
            print("⚠️  跳过 MCP 测试（未配置 API Token）")
            return False
        
        url = f"{self.config.mcp_base_url}/mcp/tools/call"
        headers = {
            "Authorization": f"Bearer {self.config.mcp_api_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        
        # MCP 请求格式
        mcp_data = {
            "params": {
                "name": "send_email",
                "arguments": {
                    "to": self.config.test_email,
                    "subject": f"[{self.config.test_sender_name}] MCP 中文测试",
                    "body": f"您好！\n\n这是通过 Python 脚本调用 MCP 服务发送的中文邮件。\n\n测试内容：\n• 中文字符：你好世界\n• 特殊符号：©®™\n• Emoji：🎉📧✅\n\n如果显示正常，说明 MCP 处理中文没有问题。\n\n测试时间：{datetime.now().strftime('%Y年%m月%d日 %H:%M:%S')}",
                    "async": False
                }
            }
        }
        
        print(f"📡 请求URL: {url}")
        if self.config.debug_verbose:
            print(f"📋 请求头: {json.dumps(headers, ensure_ascii=False, indent=2)}")
            print(f"📋 请求数据: {json.dumps(mcp_data, ensure_ascii=False, indent=2)}")
        print("-" * 30)
        
        try:
            response = self._make_request('POST', url, headers, mcp_data)
            
            print(f"✅ 响应状态码: {response.status_code}")
            
            if self.config.debug_verbose:
                print(f"📋 响应头: {json.dumps(dict(response.headers), ensure_ascii=False, indent=2)}")
            
            # 解析响应
            try:
                resp_data = response.json()
                print(f"📨 响应数据: {json.dumps(resp_data, ensure_ascii=False, indent=2)}")
                
                # 记录测试结果
                test_result = {
                    'test_type': 'mcp_service',
                    'success': response.status_code == 200 and not resp_data.get('isError', False),
                    'response_data': resp_data,
                    'timestamp': datetime.now().isoformat()
                }
                self.test_results.append(test_result)
                
                return response.status_code == 200 and not resp_data.get('isError', False)
                
            except json.JSONDecodeError:
                print(f"❌ JSON 解析失败: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ 请求失败: {e}")
            return False

    def test_encoding_analysis(self):
        """编码分析测试"""
        print("=" * 50)
        print("编码分析测试")
        print("=" * 50)
        
        test_string = "测试中文邮件编码"
        
        print(f"🔤 原始字符串: {test_string}")
        print(f"📏 字符串长度: {len(test_string)}")
        print(f"💾 UTF-8 编码: {test_string.encode('utf-8')}")
        print(f"📏 UTF-8 字节长度: {len(test_string.encode('utf-8'))}")
        
        # JSON 序列化测试
        test_obj = {"subject": test_string, "body": "中文内容"}
        
        # 不转义 Unicode
        json_str_unicode = json.dumps(test_obj, ensure_ascii=False)
        print(f"📝 JSON (Unicode): {json_str_unicode}")
        
        # 转义 Unicode
        json_str_ascii = json.dumps(test_obj, ensure_ascii=True)
        print(f"📝 JSON (ASCII): {json_str_ascii}")
        
        # 编码后的字节
        json_bytes = json_str_unicode.encode('utf-8')
        print(f"💾 JSON UTF-8 字节: {json_bytes}")

    def test_mcp_tools_list(self) -> bool:
        """测试 MCP 工具列表"""
        print("=" * 50)
        print("测试 MCP 工具列表")
        print("=" * 50)
        
        if not self.config.mcp_api_token:
            print("⚠️  跳过 MCP 工具列表测试（未配置 API Token）")
            return False
        
        url = f"{self.config.mcp_base_url}/mcp/tools"
        headers = {
            "Authorization": f"Bearer {self.config.mcp_api_token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        
        try:
            response = self._make_request('GET', url, headers)
            
            print(f"✅ 响应状态码: {response.status_code}")
            
            # 解析响应
            try:
                resp_data = response.json()
                tools = resp_data.get('tools', [])
                
                print(f"🛠️  可用工具数量: {len(tools)}")
                for i, tool in enumerate(tools, 1):
                    print(f"  {i}. {tool.get('name', 'Unknown')} - {tool.get('description', 'No description')}")
                
                return response.status_code == 200
                
            except json.JSONDecodeError:
                print(f"❌ JSON 解析失败: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ 请求失败: {e}")
            return False

    def run_all_tests(self):
        """运行所有测试"""
        print("🚀 MCP 邮件服务测试开始")
        print(f"📧 测试邮箱: {self.config.test_email}")
        print(f"🔧 当前系统编码: {sys.getdefaultencoding()}")
        print()
        
        # 编码分析
        self.test_encoding_analysis()
        print()
        
        # 测试 MCP 工具列表
        mcp_tools_success = self.test_mcp_tools_list()
        print()
        
        # 测试 qqwebhook
        qqwebhook_success = self.test_qqwebhook_direct()
        print()
        
        time.sleep(2)  # 避免请求过快
        
        # 测试 MCP
        mcp_success = self.test_mcp_service()
        print()
        
        # 总结
        self._print_summary(qqwebhook_success, mcp_success, mcp_tools_success)
        
        # 保存测试结果
        if self.config.save_test_results:
            self._save_test_results()

    def _print_summary(self, qqwebhook_success: bool, mcp_success: bool, mcp_tools_success: bool):
        """打印测试总结"""
        print("=" * 50)
        print("🎯 测试结果总结")
        print("=" * 50)
        print(f"📋 MCP 工具列表: {'✅ 成功' if mcp_tools_success else '❌ 失败'}")
        print(f"🔗 qqwebhook 直接调用: {'✅ 成功' if qqwebhook_success else '❌ 失败'}")
        print(f"🌐 MCP 服务调用: {'✅ 成功' if mcp_success else '❌ 失败'}")
        print()
        
        if qqwebhook_success and mcp_success:
            print("🎉 所有测试通过！请检查邮箱收到的邮件内容是否正确显示中文。")
        elif mcp_success:
            print("✅ MCP 服务正常！请检查邮箱收到的邮件内容。")
        else:
            print("⚠️  部分测试失败，请检查配置和网络连接。")

    def _save_test_results(self):
        """保存测试结果到文件"""
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"test_results_{timestamp}.json"
            
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(self.test_results, f, ensure_ascii=False, indent=2)
            
            print(f"💾 测试结果已保存到: {filename}")
            
        except Exception as e:
            print(f"❌ 保存测试结果失败: {e}")

def main():
    """主函数"""
    try:
        # 加载配置
        config = EmailTestConfig()
        
        # 创建测试器
        tester = EmailTester(config)
        
        # 运行测试
        tester.run_all_tests()
        
    except KeyboardInterrupt:
        print("\n⚠️  测试被用户中断")
    except Exception as e:
        print(f"❌ 测试执行失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()