import { ImageSessionPage, imageSessionMetadata } from '../../_image-tool/session-page';

export const generateMetadata = imageSessionMetadata;

export default function ColorizeSessionPage({ params }) {
  return <ImageSessionPage params={params} mode="colorize" />;
}
