type ParamPageProps = {
    params: Promise<{ id: string }>;
};

export default async function ParamPage({ params }: ParamPageProps) {
    const { id } = await params;
    return <p>No.{id}のページを表示しています</p>
}