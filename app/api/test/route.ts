import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import {Client} from "@notionhq/client"
import {createClient} from "@supabase/supabase-js"

const notion = new Client({auth:process.env.NOTION_TOKEN})
const ai =new Anthropic()
const supabase=createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const notionImageUrlPropertyName=process.env.NOTION_IMAGE_URL_PROPERTY ?? "Thumbnail Image URL"

const PROMPT=`
あなたはBtoB向けサービスサイトの事例記事ライターです。
提供された記事テキストを分析し、以下のJSON形式のみで回答してください。
説明文やMarkdownは不要です。JSONのみ出力してください。

{
  "title": "記事タイトル（20字以内）",
  "card_before": "課題（BEFORE）の要約（80字以内）",
  "card_after": "成果（AFTER）の要約（数値含む80字以内）",
  "detail_challenge": "詳しい課題説明（200字程度）",
  "detail_solution": "解決策の詳細（300字程度）",
  "detail_results": ["成果1", "成果2", "成果3", "成果4"],
  "detail_quote": "担当者コメント（100字程度）",
  "detail_quote_author": "担当者名 / 会社・役職",
  "detail": "読み物としての全文（1000〜1500字）。課題背景→解決策の詳細→成果→担当者の声の順で自然な文章で。箇条書き不可。"
}
`


async function fetchPageText(url:string):Promise<string>{
    const response=await fetch(url,{
        headers:{'User-Agent':'Mozilla/5.0'}
    })

    if(!response.ok){
        throw new Error(`URL取得失敗：${response.status} ${url}`)
    }

    const html=await response.text()

    const text=html
        .replace(/<script[\s\S]*?<\/script>/gi,'')
        .replace(/<style[\s\S]*?<\/style>/gi,'')
        .replace(/<[^>]+>/g,'')
        .replace(/&nbsp;/g,'')
        .replace(/&amp;/g,'&')
        .replace(/&lt;/g,'<')
        .replace(/&gt;/g,'>')
        .replace(/\s+/g,'')
        .trim()

    return text.slice(0,6000)
}


async function generateArticleImage(title:string,summary:string):Promise<string|null>{
    if(!process.env.OPENAI_API_KEY){
        throw new Error('OPENAI_API_KEY is not set')
    }

    const prompt =`BtoB企業の導入事例記事のサムネイル画像。テーマ：「${title}」。内容：${summary}。プロフェッショナルで清潔感があるビジネス向けイラスト。テキストや文字は含めない。明るく信頼感のある配色。`

    const response=await fetch('https://api.openai.com/v1/images/generations',{
        method:'POST',
        headers:{
            'Content-Type':'application/json',
            Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body:JSON.stringify({
            model:process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
            prompt,
            size:process.env.OPENAI_IMAGE_SIZE ?? '1024x1024',
            quality:process.env.OPENAI_IMAGE_QUALITY ?? 'low',
            output_format:process.env.OPENAI_IMAGE_FORMAT ?? 'png',           
        }),
    })

    if(!response.ok){
        const errorText=await response.text()
        throw new Error(`OpenAI image generation failed: ${response.status} ${errorText}`)
    }

    const payload=await response.json() as {
        data?:Array<{b64_json?:string}>
    }
    const imageBase64=payload.data?.[0]?.b64_json
    if(imageBase64){
        const format=process.env.OPENAI_IMAGE_FORMAT ?? 'png'
        return `data:image/${format};base64,${imageBase64}`
    }

    return null
}

function getStorageFileInfo(base64DataUrl:string,articleId:string){
    const [meta]=base64DataUrl.split(',')
    const mimeType=meta.match(/:(.*?);/)?.[1] ?? 'image/png'
    const ext =mimeType.split('/')[1] ?? 'png'

    return {
        mimeType,
        ext,
        fileName:`${articleId}.${ext}`,
    }
}


async function uploadImageToSupabase(base64DataUrl:string,articleId:string):Promise<string|null>{
    
    const [,base64Data]=base64DataUrl.split(',')
    const {mimeType,fileName}=getStorageFileInfo(base64DataUrl,articleId)


    const binaryStr=atob(base64Data)
    const bytes=new Uint8Array(binaryStr.length)
    for (let i=0;i<binaryStr.length;i++){
        bytes[i]=binaryStr.charCodeAt(i)
    }

    const {error}=await supabase.storage
        .from('article-images')
        .upload(fileName,bytes,{
            contentType:mimeType,
            upsert:true,
        })
    
    if(error){
        throw new Error(`Storage upload失敗: ${error.message}`)
    }

    const {data}=supabase.storage
        .from('article-images')
        .getPublicUrl(fileName)

    return data.publicUrl
}

export async function POST(req:NextRequest){

    const secret=req.headers.get('x-cron-secret')
    if(secret !==process.env.CRON_SECRET){
        return NextResponse.json({error:'Unauthorized'},{status:401})
    }

    try{

        const {results}=await notion.databases.query({
            database_id:process.env.NOTION_DATABASE_ID!,
            filter:{property:'Status',status:{equals:'生成待ち'}}
        })

        const log:string[]=[]
        log.push(`Notionヒット件数:${results.length}`)

        for (const page of results as any[]){
            const url=page.properties['Source URL']?.url
            if(!url){
                log.push(`[SKIP] page ${page.id}:Source URL なし`)
                continue
            }


            const {data:existing}=await supabase
                .from('cases_articles')
                .select('id')
                .eq('notion_page_id',page.id)
                .single()
            if(existing){
                log.push(`[SKIP] page ${page.id}:処理済み(cases_articles id: ${existing.id})`)
                continue
            }


            let text:string
            try{
                text=await fetchPageText(url)
                log.push(`[OK] URL取得成功: ${url} (${text.length}文字)`)
            }catch(e:any){
                log.push(`[ERROR] URL取得失敗: ${url} - ${e.message}`)
                continue
            }


            const message=await ai.messages.create({
                model:'claude-sonnet-4-5',
                max_tokens:3000,
                messages:[{role:'user',content:`${PROMPT}\n\n${text}`}]
            })

            const raw=(message.content[0] as any).text
            const generated=JSON.parse(raw.replace(/```json|```/g,'').trim())


            let imagePublicUrl:string | null=null
            let imageFileExt:string | null=null
            try{
                log.push(`[INFO]画像生成開始:${generated.title}`)
                const base64Image=await generateArticleImage(generated.title,generated.card_before)
                if(base64Image){

                    const tempId=`temp_${page.id}`
                    imageFileExt=getStorageFileInfo(base64Image,tempId).ext
                    imagePublicUrl=await uploadImageToSupabase(base64Image,tempId)
                    log.push(`[OK]画像生成・保存成功`)
                }else{
                    log.push(`[WARN]画像生成:画像データなし（スキップ）`)
                }
            }catch(e:any){

                log.push(`[WARN]画像生成失敗（スキップ）:${e.message}`)
            }


            const jstNow=new Date(Date.now()+9*60*60*1000).toISOString().replace('Z','+09:00')
            const{data:saved,error}=await supabase
                .from('cases_articles')
                .insert({
                    notion_page_id:page.id,
                    source_url:url,
                    ...generated,
                    image_url:imagePublicUrl,
                    status:'レビュー中',
                    created_at:jstNow,
                })
                .select('id')
                .single()

            if(error){
                log.push(`[ERROR]Supabase保存失敗:${error.message}`)
                continue
            }


            if(imagePublicUrl && saved && imageFileExt){
                try{
                    const tempFileName=`temp_${page.id}.${imageFileExt}`
                    const finalFileName=`${saved.id}.${imageFileExt}`
                    await supabase.storage.from('article-images').move(tempFileName,finalFileName)


                    const {data:finalUrlData}=supabase.storage
                        .from('article-images')
                        .getPublicUrl(finalFileName)

                    await supabase
                        .from('cases_articles')
                        .update({image_url:finalUrlData.publicUrl})
                        .eq('id',saved.id)

                    imagePublicUrl=finalUrlData.publicUrl
                    log.push(`[OK] 画像ファイルをarticle IDでリネーム完了`)
                }catch(e:any){
                    log.push(`[WARN] 画像リネーム失敗（temp名のまま）: ${e.message}`)
                }
            }


            const notionProperties:Record<string,any>={
                'Title':{title:[{text:{content:generated.title}}]},
                'Supabase ID':{rich_text:[{text:{content:saved!.id}}]},
                'Status':{status:{name:'レビュー中'}},
            }
            const imageUrlProperty=page.properties?.[notionImageUrlPropertyName]
            if(imageUrlProperty?.type==='url'){
                notionProperties[notionImageUrlPropertyName]={url:imagePublicUrl}
            }else if (imagePublicUrl){
                log.push(`[WARN] Notion URLプロパティ未設定: ${notionImageUrlPropertyName}`)
            }

            await notion.pages.update({
                page_id:page.id,
                properties:notionProperties
            })


            const resultBlocks=(generated.detail_results as string[]).map((r)=>({
                type:'bulleted_list_item' as const,
                bulleted_list_item:{rich_text:[{type:'text' as const,text:{content:r}}]}
            }))

            await notion.blocks.children.append({
                block_id:page.id,
                children:[
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '課題（BEFORE）' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.card_before } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '成果（AFTER）' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.card_after } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '詳細な課題' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail_challenge } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '解決策' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail_solution } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '成果' } }] } },
                    ...resultBlocks,
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '担当者コメント' } }] } },
                    { type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: `${generated.detail_quote}\n— ${generated.detail_quote_author}` } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '全文' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail } }] } },

                    ...(imagePublicUrl ?[
                        {type:'heading_2' as const,heading_2:{rich_text:[{type:'text' as const, text:{content:'サムネイル画像'}}]}},
                        {
                            type:'image' as const,
                            image:{
                                type:'external' as const,
                                external:{url:imagePublicUrl},
                            },
                        },
                    ]:[]),
                ] as any[]
            })

            log.push(`[DONE] 生成完了: ${generated.title} (${url})`)
        }

        console.log('[generate] log:',log.join('\n'))
        return NextResponse.json({ok:true,log})

    }catch(e){
        console.error('generate APIエラー:',e)
        return NextResponse.json({error:String(e)},{status:500})
    }
}