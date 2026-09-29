import type { CriterionPrompt } from './promptTypes';

export const FEEDBACK_DISABLED_CRITERIA = [413, 416, 547, 548] as const;

export const FEEDBACK_FIRST_PASS_GUIDANCE = [
  '이 평가는 종료된 인앱 상담의 1차 문제 후보 검출이다. 상담 종료만으로 실제 문제 해결이나 고객 만족을 추정하지 않는다.',
  'violated=true는 원문에 근거한 검토할 만한 문제 후보가 있다는 뜻이다. 하나 이상이면 need_review=true이고, 없으면 need_review=false이다.',
  '1차 평가는 최종 Cold/Hot 판정이 아니다. need_review=false를 최종 Hot 확정으로 해석하지 않는다. 검토 필요이면서 최종 Hot인 조합도 정상이다.',
  '총평과 참고 점수는 사람이 상담 전반을 이해하기 위한 참고 정보다. 총평·점수는 체크리스트의 문제 후보 검출 및 need_review 판단을 강화하거나 상쇄하지 않는다.',
  '전체적으로 좋은 상담이어도 구체적인 문제 후보가 있으면 검토 필요로 분류한다. 전체적으로 아쉬운 상담이어도 구체적인 근거 없이 검토 필요로 분류하지 않는다.',
  '항목 적용 대상이 아닌 경우와 문제 후보가 있으나 감안할 수 있는 경우를 구분한다. 적용 조건에 해당하는 문제 후보는 검출하고, 경미함·단발성 등 최종 감안 판단은 별도 2차 또는 수기 검수에서 수행한다.',
  '문제 후보와 근거 인용은 제공된 원문에서만 찾는다. 의도·악의·고객 반응·문제 해결 여부를 추측으로 만들지 않는다.',
  '413·416은 텍스트로 평가하지 않는다. 547·548은 정책 조회가 준비되기 전까지 비활성이다. 이 항목들은 csChecklist에 넣거나 정상으로 저장하지 않는다.',
  '모델 일반지식으로 회사 정책·보상·금전 기준을 추측하거나 다른 항목으로 우회 판정하지 않는다. 예시 속 정책·기간·금액·절차는 실제 회사 정책의 근거가 아니다. 다른 항목도 제공된 원문만으로 확인되는 표현·질문과 답변의 관계만 평가한다.',
  '공통 항목명·분류는 식별용이다. 이 채널의 상세 정의를 적용하며 음성 정보는 추정하지 않는다.',
  '문서에 없는 항목 우선순위, 같은 장면의 단일 항목 제한, 항목 병합 기준을 만들지 않는다. 각 항목의 명시된 조건을 독립적으로 확인한다.',
  '출력은 기존 JSON 스키마를 유지한다. 새 판정 상태나 최종 Cold/Hot 출력 필드를 추가하지 않는다.',
].join('\n');

export const FEEDBACK_CHECKLIST_TEMPLATE = [
  '── 인앱 1차 검토 후보 체크리스트 ──',
  FEEDBACK_FIRST_PASS_GUIDANCE,
  '아래 활성 {{criteria_count}}개 항목만 각각 한 번씩 csChecklist에 포함한다. 그 외 항목은 출력하지 않는다.',
  'violated에는 문제 후보 검출 여부, reason에는 원문에 근거한 이유를 작성한다. true이면 고객 맥락과 상담사 답변을 evidence.quote에 화자 접두사와 함께 원문 그대로 인용한다.',
  'evidence.atSec는 제공된 대화의 상대 시각을 사용한다. 시각이 없으면 기존 호환값 0을 사용하며 이를 응답 대기시간의 근거로 해석하지 않는다.',
  '{{criteria_list}}',
].join('\n\n');

/** Reviewed edits to the existing phone details, preserving all dynamic field keys. */
export function feedbackFields(source: CriterionPrompt): Record<string, string> {
  if (FEEDBACK_DISABLED_CRITERIA.includes(source.criterionId as typeof FEEDBACK_DISABLED_CRITERIA[number])) {
    throw new Error(`비활성 항목 ${source.criterionId}은 새 인앱 상세로 재정의하지 않습니다`);
  }
  const fields = Object.fromEntries(Object.entries(source.fields).map(([k, v]) => [k,
    v.replaceAll('STT', '대화 원문').replaceAll('다시 전화 주세요', '다시 문의해 주세요').replaceAll('전화한 건데요', '문의한 건데요'),
  ]));
  switch (source.criterionId) {
    case 415:
      fields.definition = '고객의 문의 상황에 담긴 감정에 대한 요약 재진술 + 공감 멘트가 함께 구사되지 않은 경우. 감정 언급 없이 처리 안내만 진행한 경우 포함.';
      fields.good = '고객: "왜이렇게 배송이 지연되나요? 몇번째 확인하는데 번거롭네요!" 상담사: "여러 차례 배송이 지연돼서 많이 불편하셨겠어요. 확인해보니 재고 이슈로 지연된 건이라 오늘 바로 재발송 처리해드렸어요."';
      fields.bad = '[반복오류당혹] "게시글 오류와 관련하여 다시 문의해 주셨네요. 혹시라도 이후에 동일한 오류가 발생하면 언제든지 다시 문의해 주세요." (고생한 정황에 대한 공감 없이 바로 안내) / [탈퇴복구아쉬움] "아쉽게도 현재 다른 계정의 온도를 연동하는 기능은 제공하고 있지 않아요." (쿠션어만 사용, 실질적 공감 없음)';
      break;
    case 407:
      fields.definition = '상담 시작과 종료 시점에 각각 발생하는 인사를 누락한 경우. 인사의 구성은 인사말 + 소속이며, "무엇을 도와드릴까요?"를 함께 구사해도 좋거나 감안. 고객이 "수고하십니다", "안녕하세요" 인사를 하는 경우 알맞는 화답인사를 같이 해야 함. 종료인사는 발생 시점 한 번만 평가하며, 이후 상담이 이어진 경우 마지막 시점에 다시 구사하는 것으로 한다.';
      fields.good = '최초인사: 안녕하세요(반갑습니다). 당근 (서비스명) 고객센터 ○○입니다. 화답인사: (수고하십니다라고 할 경우) 감사합니다. 종료인사: 이용해 주셔서 감사합니다, 좋은 하루 되세요.';
      fields.exception = (fields.exception ?? '').replace('대화 원문 앞뒤가 잘려 인사 구간이 전사에 없는 경우', '제공된 원문 앞뒤가 누락되어 인사 구간을 확인할 수 없는 경우');
      break;
    case 408:
      fields.definition = '① 배려 표현: 고령·디지털 취약 고객, 불편·클레임 상황 등 배려가 필요한 상황에서 배려의 말이 없는 경우.\n② 사과 표현: 회사 또는 상담사 귀책으로 불편을 끼친 상황에서 사과 표현 없이 처리만 진행하는 경우. 여러 번 표현하는 경우 각각 사과를 진행한다.\n③ 쿠션어: 고객에게 직접 실행을 요청하기 전 또는 불가상황 안내 시 완충 표현(번거로우시겠지만, 죄송하지만 등) 없이 바로 요구하는 경우.';
      fields.good = '① 배려 표현: 당근 앱 사용이 가능하실까요?\n② 사과 표현: 이용에 불편이 있으셨던 점 사과말씀 드립니다.\n③ 쿠션어: 번거로우시겠지만, 신분증 사진 한 장만 보내주실 수 있을까요? 죄송하지만 본인께서 직접 처리만 가능해서, 앱에서 실행이 가능하실까요?';
      fields.bad = '① 배려가 필요한 상황에 배려 표현 없음.\n② 회사 귀책 불편 상황에도 사과 없이 "네, 확인해드릴게요".\n③ 쿠션어 없이 "신분증 사진 보내주세요."';
      fields.exception = '동일한 상황에 대한 배려표현이나 쿠션어는 한 번 진행했을 경우 생략해도 감안한다. 화답 표현은 기존 인사 누락 항목에서 판정하므로 여기서 제외한다.';
      break;
    case 418:
      fields.exception = (fields.exception ?? '').replace(/\[원음\][^\n]*/g, '').trim();
      break;
    case 652:
      fields.exception = '고객이 질문을 철회한 경우는 제외.';
      break;
    case 545:
      fields.definition = '반말, 욕설·비속어, 비아냥거리는 표현, 고객을 탓하는 발언, 고객과의 언쟁 등 텍스트에서 명백한 불친절 요소가 확인되는 경우.';
      fields.good = '고객이 강한 불만을 표현해도 정중한 존댓말을 유지하고 고객 탓 없이 상황을 설명.';
      fields.bad = (fields.bad ?? '').replace(/\s*\/\s*들릴 정도로 크게 내쉬는 의도적 한숨/g, '').trim();
      fields.exception = '실수성 표현 여부와 최종 감안은 수기 검수에서 확인한다. 원문에 없는 의도성·악의성을 추정하지 않는다.';
      break;
    case 546:
      fields.bad = (fields.bad ?? '').replace('무미건조하고 도움을 주려는 의지가 없는 음성으로 ', '');
      break;
    case 411:
      fields.exception = (fields.exception ?? '').replace('말투가 부드러워', '텍스트 표현이 부드러워');
      break;
  }
  return fields;
}
