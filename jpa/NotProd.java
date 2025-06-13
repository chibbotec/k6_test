package com.ll.techinterview.global.initData;

import com.ll.techinterview.domain.contest.entity.Answer;
import com.ll.techinterview.domain.contest.entity.Contest;
import com.ll.techinterview.domain.contest.entity.Participant;
import com.ll.techinterview.domain.contest.entity.Problem;
import com.ll.techinterview.domain.contest.repository.ContestRepository;
import com.ll.techinterview.domain.note.document.Note;
import com.ll.techinterview.domain.note.repository.NoteRepository;
import com.ll.techinterview.domain.qna.entity.Comment;
import com.ll.techinterview.domain.qna.entity.ParticipantQnA;
import com.ll.techinterview.domain.qna.entity.Question;
import com.ll.techinterview.domain.qna.repository.QuestionRepository;
import com.ll.techinterview.domain.qna.repository.TechInterviewRepository;
import com.ll.techinterview.global.jpa.TechInterview;
import com.ll.techinterview.global.techEnum.Submit;
import com.ll.techinterview.global.techEnum.TechClass;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;

@Configuration
@Profile("!prod")
@RequiredArgsConstructor
@Slf4j
public class NotProd {

    private final Random random = new Random();

    // N+1 문제 확인을 위한 테스트 데이터 수량 설정
    private static final int TEST_NUMBER = 50; // 기본값 (변경 가능)
    private static final int RELATED_DATA_COUNT = 500; // 연관 데이터 개수

    @Bean
    public ApplicationRunner applicationRunner(
            TechInterviewRepository techInterviewRepository,
            QuestionRepository questionRepository,
            ContestRepository contestRepository,
            NoteRepository noteRepository
    ) {
        return new ApplicationRunner() {
            @Transactional
            @Override
            public void run(ApplicationArguments args) throws Exception {
                // 기존 데이터 존재 확인
                boolean dataExists = !techInterviewRepository.findAll().isEmpty();

                if (dataExists) {
                    log.info("초기 데이터가 이미 존재합니다. 데이터 생성을 건너뜁니다.");
                    return;
                }

                log.info("N+1 문제 확인용 초기 데이터 생성 시작...");
                log.info("테스트 데이터 수: {}, 연관 데이터 수: {}", TEST_NUMBER, RELATED_DATA_COUNT);

                // 1. TechInterview 생성
                List<TechInterview> techInterviews = generateTechInterviews(techInterviewRepository, TEST_NUMBER);

                // 2. Question 생성 (각 Question마다 ParticipantQnA와 Comment 500개씩)
                List<Question> questions = generateQuestions(questionRepository, techInterviews, TEST_NUMBER);

                // 3. Contest 생성 (각 Contest마다 Participant, Problem, Answer 500개씩)
                List<Contest> contests = generateContests(contestRepository, techInterviews, TEST_NUMBER);

                // 4. Note 생성
                generateNotes(noteRepository, TEST_NUMBER);

                log.info("초기 데이터 생성 완료!");
            }
        };
    }

    private List<TechInterview> generateTechInterviews(TechInterviewRepository repository, int count) {
        log.info("TechInterview {} 개 생성 중...", count);
        List<TechInterview> techInterviews = new ArrayList<>();
        TechClass[] techClasses = TechClass.values();

        for (int i = 0; i < count; i++) {
            TechInterview techInterview = TechInterview.builder()
                    .techClass(techClasses[random.nextInt(techClasses.length)])
                    .question("기술 면접 질문 " + i + ": " + generateRandomQuestion())
                    .build();

            repository.save(techInterview);
            techInterviews.add(techInterview);
        }

        log.info("TechInterview 생성 완료: {} 개", techInterviews.size());
        return techInterviews;
    }

    private List<Question> generateQuestions(QuestionRepository repository,
                                             List<TechInterview> techInterviews, int count) {
        log.info("Question {} 개 생성 중... (각각 ParticipantQnA {}, Comment {} 개)",
                count, RELATED_DATA_COUNT, RELATED_DATA_COUNT);

        List<Question> questions = new ArrayList<>();

        for (int i = 0; i < count; i++) {
            Question question = Question.builder()
                    .spaceId(1L)
                    .authorId((long) (i % 10 + 1)) // 1~10 순환
                    .authorNickname("작성자" + (i % 10 + 1))
                    .techInterview(techInterviews.get(i % techInterviews.size()))
                    .participants(new ArrayList<>())
                    .comments(new ArrayList<>())
                    .build();

            // ParticipantQnA 생성 (N+1 문제 확인용)
            List<ParticipantQnA> participants = new ArrayList<>();
            for (int j = 0; j < RELATED_DATA_COUNT; j++) {
                ParticipantQnA participant = ParticipantQnA.builder()
                        .memberId((long) (j % 100 + 1)) // 1~100 순환
                        .nickname("참가자" + (j % 100 + 1))
                        .question(question)
                        .build();
                participants.add(participant);
            }
            question.setParticipants(participants);

            // Question 먼저 저장
            Question savedQuestion = repository.save(question);

            // Comment 생성 (N+1 문제 확인용)
            List<Comment> comments = new ArrayList<>();
            for (int j = 0; j < RELATED_DATA_COUNT; j++) {
                Comment comment = Comment.builder()
                        .question(savedQuestion)
                        .participantQna(participants.get(j % participants.size()))
                        .comment("댓글 내용 " + j + ": " + generateRandomComment())
                        .build();
                comments.add(comment);
            }
            savedQuestion.setComments(comments);

            // 최종 저장
            repository.save(savedQuestion);
            questions.add(savedQuestion);

            if ((i + 1) % 10 == 0) {
                log.info("Question 생성 진행률: {}/{}", i + 1, count);
            }
        }

        log.info("Question 생성 완료: {} 개", questions.size());
        return questions;
    }

    private List<Contest> generateContests(ContestRepository repository,
                                           List<TechInterview> techInterviews, int count) {
        log.info("Contest {} 개 생성 중... (각각 Participant {}, Problem {}, Answer {} 개)",
                count, RELATED_DATA_COUNT, RELATED_DATA_COUNT, RELATED_DATA_COUNT);

        List<Contest> contests = new ArrayList<>();

        for (int i = 0; i < count; i++) {
            Contest contest = Contest.builder()
                    .spaceId(1L)
                    .title("기술 면접 대회 " + i)
                    .timeoutMillis(3600000L) // 1시간
                    .submit(Submit.IN_PROGRESS)
                    .participants(new ArrayList<>())
                    .problems(new ArrayList<>())
                    .build();

            // Participant 생성 (N+1 문제 확인용)
            List<Participant> participants = new ArrayList<>();
            for (int j = 0; j < RELATED_DATA_COUNT; j++) {
                Participant participant = Participant.builder()
                        .memberId((long) (j % 200 + 1)) // 1~200 순환
                        .nickname("참가자" + (j % 200 + 1))
                        .submit(j % 3 == 0 ? Submit.COMPLETED : Submit.IN_PROGRESS)
                        .contest(contest)
                        .answers(new ArrayList<>())
                        .build();
                participants.add(participant);
            }
            contest.setParticipants(participants);

            // Problem 생성 (N+1 문제 확인용)
            List<Problem> problems = new ArrayList<>();
            for (int j = 0; j < RELATED_DATA_COUNT; j++) {
                Problem problem = Problem.builder()
                        .techInterview(techInterviews.get(j % techInterviews.size()))
                        .contest(contest)
                        .answers(new ArrayList<>())
                        .build();
                problems.add(problem);
            }
            contest.setProblems(problems);

            // Contest 먼저 저장
            Contest savedContest = repository.save(contest);

            // Answer 생성 (N+1 문제 확인용) - 각 Participant마다 각 Problem에 대한 답변
            for (int p = 0; p < Math.min(50, participants.size()); p++) { // 성능상 50명만
                Participant participant = participants.get(p);
                for (int pr = 0; pr < Math.min(10, problems.size()); pr++) { // 문제도 10개만
                    Problem problem = problems.get(pr);

                    Answer answer = Answer.builder()
                            .problem(problem)
                            .participant(participant)
                            .answer("답변 내용 " + p + "-" + pr + ": " + generateRandomAnswer())
                            .rankScore(random.nextInt(100) + 1)
                            .feedback("피드백 " + p + "-" + pr)
                            .build();

                    participant.getAnswers().add(answer);
                    problem.getAnswers().add(answer);
                }
            }

            // 최종 저장
            repository.save(savedContest);
            contests.add(savedContest);

            if ((i + 1) % 10 == 0) {
                log.info("Contest 생성 진행률: {}/{}", i + 1, count);
            }
        }

        log.info("Contest 생성 완료: {} 개", contests.size());
        return contests;
    }

    private void generateNotes(NoteRepository repository, int count) {
        log.info("Note {} 개 생성 중...", count * 2); // public + private

        for (int i = 0; i < count; i++) {
            // Public Note
            Note publicNote = Note.builder()
                    .spaceId(1L)
                    .title("공개 노트 " + i)
                    .content("공개 노트 내용 " + i + ": " + generateRandomContent())
                    .author(Note.Author.builder()
                            .id((long) (i % 20 + 1))
                            .nickname("작성자" + (i % 20 + 1))
                            .build())
                    .publicAccess(true)
                    .build();
            repository.save(publicNote);

            // Private Note
            Note privateNote = Note.builder()
                    .spaceId(1L)
                    .title("비공개 노트 " + i)
                    .content("비공개 노트 내용 " + i + ": " + generateRandomContent())
                    .author(Note.Author.builder()
                            .id((long) (i % 20 + 1))
                            .nickname("작성자" + (i % 20 + 1))
                            .build())
                    .publicAccess(false)
                    .build();
            repository.save(privateNote);
        }

        log.info("Note 생성 완료: {} 개", count * 2);
    }

    // 랜덤 데이터 생성 메서드들
    private String generateRandomQuestion() {
        String[] questions = {
                "Java의 GC 동작 원리에 대해 설명해주세요.",
                "Spring Boot의 자동 설정 원리는 무엇인가요?",
                "JPA N+1 문제와 해결방법을 설명해주세요.",
                "RESTful API 설계 원칙을 설명해주세요.",
                "데이터베이스 인덱스의 장단점은 무엇인가요?",
                "동시성 처리 방법에 대해 설명해주세요.",
                "캐싱 전략에 대해 설명해주세요.",
                "마이크로서비스 아키텍처의 장단점은 무엇인가요?"
        };
        return questions[random.nextInt(questions.length)];
    }

    private String generateRandomComment() {
        String[] comments = {
                "좋은 질문이네요!",
                "이 부분에 대해 더 자세히 알고 싶습니다.",
                "실무에서 많이 사용되는 내용이네요.",
                "추가적인 설명이 필요할 것 같습니다.",
                "경험담을 공유해주세요."
        };
        return comments[random.nextInt(comments.length)];
    }

    private String generateRandomAnswer() {
        String[] answers = {
                "이 문제는 다음과 같이 해결할 수 있습니다...",
                "먼저 기본 개념부터 설명드리겠습니다...",
                "실무 경험을 바탕으로 말씀드리면...",
                "이론적 배경과 실제 구현 방법은...",
                "성능 최적화 관점에서 보면..."
        };
        return answers[random.nextInt(answers.length)] + " " + UUID.randomUUID().toString().substring(0, 8);
    }

    private String generateRandomContent() {
        String[] contents = {
                "이 문서는 기술 면접 준비를 위한 내용입니다.",
                "중요한 개념들을 정리해보겠습니다.",
                "실무에서 자주 사용되는 패턴들입니다.",
                "성능 최적화를 위한 팁들을 모았습니다.",
                "트러블슈팅 경험을 정리한 내용입니다."
        };
        return contents[random.nextInt(contents.length)] + " " + UUID.randomUUID().toString().substring(0, 8);
    }
}