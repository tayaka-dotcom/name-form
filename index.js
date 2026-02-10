const line = require('@line/bot-sdk');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

// ===============================
// SQLite 初期化
// ===============================
const dbPath = '/data/medical.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      name TEXT,
      email TEXT
    )
  `);
});

// ===============================
// アカウント別 LINE 設定
// ===============================
const configs = {
  a: {
    channelAccessToken: process.env.A_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.A_CHANNEL_SECRET
  },
  b: {
    channelAccessToken: process.env.B_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.B_CHANNEL_SECRET
  }
};

const app = express();

// ===============================
// A の社員一覧ページ（削除ボタン付き）
// ===============================
app.get('/patients', (req, res) => {
  const db2 = new sqlite3.Database(dbPath);

  db2.all("SELECT * FROM patients", (err, rows) => {
    if (err) return res.status(500).send("DBエラー");

    let html = `
      <html>
      <head>
        <meta charset="UTF-8">
        <title>社員一覧</title>
        <style>
          body { font-family: sans-serif; padding: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 8px; }
          th { background: #f0f0f0; }
          a.delete { color: red; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>社員一覧</h1>
        <table>
          <tr>
            <th>番号</th>
            <th>名前</th>
            <th>メール</th>
            <th>削除</th>
          </tr>
    `;

    rows.forEach(r => {
      html += `
        <tr>
          <td>${r.id}</td>
          <td>${r.name}</td>
          <td>${r.email}</td>
          <td><a class="delete" href="/delete?id=${r.id}" onclick="return confirm('本当に削除しますか？');">削除</a></td>
        </tr>
      `;
    });

    html += `
        </table>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// ===============================
// A のブラウザ削除
// ===============================
app.get('/delete', (req, res) => {
  const id = req.query.id;

  db.run('DELETE FROM patients WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).send("削除中にエラーが発生しました");
    return res.redirect('/patients');
  });
});

// ===============================
// Webhook（A / B 分岐）
// ===============================
app.post('/webhook/:account', (req, res) => {
  const account = req.params.account; // a or b
  const config = configs[account];
  const client = new line.Client(config);

  line.middleware(config)(req, res, () => {
    Promise
      .all(req.body.events.map(event => handleEvent(event, client, account)))
      .then(() => res.sendStatus(200))
      .catch(err => {
        console.error(err);
        res.sendStatus(500);
      });
  });
});
// ★★★ ここに追加する！ ★★★ app.post('/name', async (req, res) => { const { userId, name } = req.body; // 名前を保存 userState[userId] = { step: 'afterName', name }; // Bアカウントで push する const client = new line.Client(configs.b); await client.pushMessage(userId, [ { type: 'text', text: 'ご回答ありがとうございます！\n次に、現在の就業状態を教えてください。' }, { type: 'text', text: '「新規入社」または「既存入社」を選択してください。', quickReply: { items: [ { type: 'action', action: { type: 'message', label: '新規入社', text: '新規入社' } }, { type: 'action', action: { type: 'message', label: '既存入社', text: '既存入社' } } ] } } ]); res.sendStatus(200); });
// ===============================
// 会話ステート管理（A / B 共通）
// ===============================
const userState = {};

// ===============================
// メイン処理
// ===============================
async function handleEvent(event, client, account) {
  const userId = event.source.userId;

  // ▼ B アカウントのときだけ「友だち追加時」のメッセージを送る
  if (account === 'b' && event.type === 'follow') {
    try {
      const profile = await client.getProfile(userId);
      userState[userId] = { step: 'waitingName' };

await client.replyMessage(event.replyToken, { type: 'text', text: `${profile.displayName}さん\n` + `📢ご登録ありがとうございます！\n` + `こちらは、テクノワールド株式会社の公式LINEとなります。\n\n` + `LINE登録のためお名前をフルネームで教えてください $`, emojis: [ { index: 52, // ← $ の位置（正確に数えてある） productId: "5ac21a18040ab15980c9b43e", emojiId: "014" } ] });
    } catch (e) {
      console.error(e);
    }
    return;
  }

  // ここから下はメッセージイベントのみ処理
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const text = event.message.text;

  if (account === 'a') {
    return handleA(event, client, text, userId);
  }

  if (account === 'b') {
    return handleB(event, client, text, userId);
  }
}

// ===============================
// A の処理（あなたのコードを完全移植）
// ===============================
function handleA(event, client, text, userId) {

  // 新しい操作が来たらステートリセット
  if (['#1', '発番', '操作案内', '新規社員', '既存社員'].includes(text) ||
      text.startsWith('検索') || text.startsWith('編集')) {
    delete userState[userId];
  }

  // 操作案内
  if (text === '操作案内') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text:
        '「発番」・・・初めてご利用の方は「発番」とご入力頂きナンバーを発番して下さい。\n' +
        '「検索氏名」・・・ナンバーをお忘れの方は、先頭に「検索」とご入力頂き、続けて氏名をご入力下さい。（例）検索山田太郎\n' +
        '「編集ナンバー」・・・メールアドレスにご変更のある方は、先頭に「編集」とご入力頂き、続けてご自身のナンバーをご入力ください。（例）編集1234\n' +
        '※「」不要、英数字記号は半角'
    });
  }

  // メニュー
  if (text === '#1') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'どちらかご選択下さい',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '新規社員', text: '新規社員' } },
          { type: 'action', action: { type: 'message', label: '既存社員', text: '既存社員' } }
        ]
      }
    });
  }

  // 新規社員
  if (text === '新規社員') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '初めてご利用の方は「発番」とご入力頂きナンバーを発番して下さい。',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '発番', text: '発番' } }
        ]
      }
    });
  }

  // 検索
  if (text.startsWith('検索')) {
    const id = text.replace('検索', '');

    db.get('SELECT * FROM patients WHERE id = ?', [id], (err, row) => {
      if (!row) {
        return client.replyMessage(event.replyToken, { type: 'text', text: `ID ${id} は存在しません` });
      }

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `【番号: ${row.id}】\n名前: ${row.name}\nメール: ${row.email}`
      });
    });

    return;
  }

  // 編集
  if (text.startsWith('編集')) {
    const id = text.replace('編集', '');

    userState[userId] = { step: 'editEmail', editId: id };

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `ID ${id} の新しいメールアドレスを入力してください`
    });
  }

  // 編集 → メール更新
  if (userState[userId]?.step === 'editEmail') {
    const id = userState[userId].editId;
    const newEmail = text;

    db.run(
      'UPDATE patients SET email = ? WHERE id = ?',
      [newEmail, id],
      function(err) {
        delete userState[userId];

        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: `ID ${id} のメールアドレスを更新しました！`
        });
      }
    );

    return;
  }

  // 発番
  if (text === '発番') {
    userState[userId] = { step: 'askName' };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'お名前を入力してください'
    });
  }

  // 名前入力
  if (userState[userId]?.step === 'askName') {
    userState[userId].name = text;
    userState[userId].step = 'askEmail';

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'メールアドレスを入力してください'
    });
  }

  // メール入力 → 保存
  if (userState[userId]?.step === 'askEmail') {
    const name = userState[userId].name;
    const email = text;

    db.run(
      'INSERT INTO patients (userId, name, email) VALUES (?, ?, ?)',
      [userId, name, email],
      function(err) {
        const newId = this.lastID;

        delete userState[userId];

        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: `発番完了いたしました。\nあなたの編集用ナンバーは「${newId}」です。`
        });
      }
    );

    return;
  }

  // 通常メッセージ
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text:
      '「#1」から該当項目をご選択ください。\n' +
      '各種操作案内につきましては「操作案内」とご入力ください。\n' +
      '※「」不要、英数字記号は半角'
  });
}

// ===============================
// B の処理（新仕様）
// ===============================
function handleB(event, client, text, userId) {
  const trimmed = text.trim();

  if (!userState[userId]) {
    userState[userId] = { step: 'idle' };
  }


  // ② 就業状態の選択（新規入社 / 既存入社）
  if (trimmed === '新規入社' || trimmed === '既存入社') {
    userState[userId].step = 'afterStatus';

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '',
      quickReply: {
        items: [
          {
            type: 'action',
            action: { type: 'message', label: '入社書類について', text: '入社書類について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: '研修・講習について', text: '研修・講習について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: '各種届出・申請について', text: '各種届出・申請について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: 'マイページについて', text: 'マイページについて' }
          }
        ]
      }
    });
  }

  // ③ 『入社書類について』が入力された場合
  if (trimmed.includes('入社書類')) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '▼',
      quickReply: {
        items: [
          {
            type: 'action',
            action: { type: 'message', label: '提出書類の内容について', text: '提出書類の内容について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: '提出方法・期限について', text: '提出方法・期限について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: 'よくある質問', text: 'よくある質問' }
          },
          {
            type: 'action',
            action: { type: 'message', label: 'その他', text: 'その他' }
          }
        ]
      }
    });
  }

  // ④ 『研修・講習について』が入力された場合
  if (trimmed.includes('研修') || trimmed.includes('講習')) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '▼',
      quickReply: {
        items: [
          {
            type: 'action',
            action: { type: 'message', label: '配属前研修について', text: '配属前研修について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: '講習／特別教育について', text: '講習／特別教育について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: '資格取得について', text: '資格取得について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: 'その他', text: 'その他' }
          }
        ]
      }
    });
  }

// ⑤ 『各種届出・申請について』が入力された場合
  if (trimmed.includes('各種届出') || trimmed.includes('申請')) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '▼',
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: '個人情報（住所変更等）について', text: '個人情報（住所変更等）について' }
        },
        {
          type: 'action',
          action: { type: 'message', label: '資格関係について', text: '資格関係について' }
        },
        {
          type: 'action',
          action: { type: 'message', label: '休暇・休職について', text: '休暇・休職について' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'その他', text: 'その他' }
        }
      ]
    }
  });
}

  // ⑥ 『マイページについて』が入力された場合
  if (trimmed.includes('マイページ')) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '▼',
      quickReply: {
        items: [
          {
            type: 'action',
            action: { type: 'message', label: 'ログインURL', text: 'ログインURL' }
          },
          {
            type: 'action',
            action: { type: 'message', label: 'ログイン方法について', text: 'ログイン方法について' }
          },
          {
            type: 'action',
            action: { type: 'message', label: '操作マニュアルについて', text: '操作マニュアルについて' }
          },
          {
            type: 'action',
            action: { type: 'message', label: 'その他', text: 'その他' }
          }
        ]
      }
    });
  }

}

// ===============================
// サーバー起動
// ===============================
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

