import { createRoot } from 'react-dom/client';
import RdMobilePage from './components/RdMobile/RdMobilePage';
import ReviewMobilePage from './components/RdMobile/ReviewMobilePage';

const reviewPath = /\/(rd-mobile\/(tasks|review)|qc-mobile\/(exceptions|exception))/.test(window.location.pathname);
createRoot(document.getElementById('root')!).render(reviewPath ? <ReviewMobilePage /> : <RdMobilePage />);
