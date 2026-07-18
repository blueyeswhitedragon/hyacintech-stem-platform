import { generateTopicCardDrafts } from '../app/lib/dataLab/bootstrap/service';

async function main() {
  console.log('测试话题卡一键生成（默认 provider）...');
  try {
    const result = await generateTopicCardDrafts(
      { theme: '测试主题', count: 1, user: { id: '1e294d85-93b0-4280-9a25-a3f80eeeaeb2', username: 'data-admin', role: 'admin', displayName: 'Data Admin' } },
    );
    console.log('✅ 生成成功:', { completed: result.completed, failed: result.failed });
    if (result.failures.length) {
      console.log('失败详情:', JSON.stringify(result.failures, null, 2));
    }
    if (result.cards.length) {
      console.log('生成的卡片:', result.cards.map((c) => ({ id: c.id, title: c.displayTitle, status: c.status })));
    }
  } catch (error) {
    console.error('❌ 生成失败:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) console.error(error.stack);
  }
}

main().catch(console.error);
