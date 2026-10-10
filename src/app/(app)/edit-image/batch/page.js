import { ImageBatchPage } from '../../_image-tool/batch-page';

export const metadata = { title: 'Edit Image' };

export default function EditImageBatchPage({ searchParams }) {
  return <ImageBatchPage searchParams={searchParams} mode="edit" />;
}
