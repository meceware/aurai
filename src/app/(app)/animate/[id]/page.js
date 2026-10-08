import { VideoSessionPage, videoSessionMetadata } from '../../_video-tool/session-page';

export const generateMetadata = videoSessionMetadata;

export default function AnimateSessionPage({ params }) {
  return <VideoSessionPage params={params} tool="animate" />;
}
